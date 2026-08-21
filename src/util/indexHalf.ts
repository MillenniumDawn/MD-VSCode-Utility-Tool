import * as vscode from "vscode";
import {
	computeStaleFiles,
	IndexTimer,
	loadCacheData,
	loadCacheManifest,
	saveCacheData,
	saveCacheManifest,
} from "./indexCache";
import { indexParseQueue, IndexProgress } from "./indexBuild";
import { IndexFile, IndexListing, toIndexFiles } from "./indexListing";
import { readFileFromModOrHOI4 } from "./fileloader";
import { localize } from "./i18n";
import { Logger } from "./logger";

/*
 * One build of one half of one index.
 *
 * Every index is built in two halves -- the vanilla install and the workspace -- and all four
 * indexes did it with the same hundred lines: start a timer, list the files, load the manifest,
 * work out what is still fresh, restore that from the cache, parse whatever is left through the
 * shared queue while reporting progress, then write the cache back. Those copies were identical
 * down to the comment text, which is why every fix to the indexing had to be made four times.
 *
 * What genuinely differs between them is the shape of what they cache, so that is what the two
 * callbacks cover: `hydrate` puts a loaded cache back into the live index, and `serialize` hands
 * back whatever should be written. Everything else is here.
 */
export interface IndexHalfSpec<TCache> {
	/** Names the cache files and the timer's phases, e.g. `"gfxIndex.workspace"`. */
	cacheName: string;
	/** Bump to make previously written caches be ignored rather than misread. */
	version: number;
	listFiles: (token: vscode.CancellationToken) => Promise<IndexListing>;
	/**
	 * Restore everything in `cached` whose file is not in `skipFiles` -- those are the files about
	 * to be re-parsed or gone. Throwing here is treated as a corrupt cache, exactly as a failed
	 * JSON.parse is, and the build falls back to parsing everything.
	 */
	hydrate: (cached: TCache, skipFiles: Set<string>) => void;
	/** Parses one file into the live index. Reports its own failures and does not throw. */
	parseFile: (file: IndexFile) => Promise<void>;
	/** The live index in the form it should be cached. */
	serialize: () => TCache;
}

export async function buildIndexHalf<TCache>(
	spec: IndexHalfSpec<TCache>,
	progress: IndexProgress,
): Promise<void> {
	const timer = new IndexTimer(spec.cacheName);
	try {
		await buildIndexHalfWithTimer(spec, progress, timer);
	} finally {
		// A build that threw must not leave a phase behind in the live-build report.
		timer.dispose();
	}
}

async function buildIndexHalfWithTimer<TCache>(
	spec: IndexHalfSpec<TCache>,
	progress: IndexProgress,
	timer: IndexTimer,
): Promise<void> {
	const { cacheName, version } = spec;

	// The listing runs here rather than in the caller so that the timer covers it. On a desktop
	// install it is now the directory walk and the mtimes together, which is where a slow cold build
	// spends its time, and it used to happen before the timer existed.
	timer.begin("list");
	const { filePaths, uris, mtimes } = await spec.listFiles(progress.token);

	timer.begin("cache");
	const manifest = await loadCacheManifest(cacheName, version);
	let filesToParse = filePaths;

	if (manifest) {
		const staleness = computeStaleFiles(manifest, mtimes);
		const cachedData = await loadCacheData(cacheName);

		// Whatever is still fresh gets reused, however much of the listing changed. This used to be
		// gated on stale + removed + added being fewer than the files listed, so a large pull -- or
		// a manifest naming files that have since been deleted, which count towards that sum but
		// not towards the listing -- threw away a cache that was still most of the way good. The
		// stale files have to be parsed either way, so counting them only ever added work.
		if (cachedData) {
			try {
				const cached: TCache = JSON.parse(cachedData);
				const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
				spec.hydrate(cached, skipFiles);
				filesToParse = [...staleness.stale, ...staleness.added];
			} catch {
				Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
				filesToParse = filePaths;
			}
		}
	}

	timer.begin("parse");
	let parsed = 0;
	const toParse = toIndexFiles(filesToParse, uris);
	progress.report(0, toParse.length);
	await indexParseQueue.map(
		toParse,
		async (file) => {
			await spec.parseFile(file);
			timer.progress(++parsed, toParse.length);
			progress.report(parsed, toParse.length);
		},
		{ token: progress.token },
	);
	timer.end(filePaths.length, filesToParse.length);

	// fire-and-forget: write data before manifest for atomicity
	void Promise.all([
		saveCacheData(cacheName, JSON.stringify(spec.serialize())),
		saveCacheManifest(cacheName, filePaths, mtimes, version),
	]).catch((e) => Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}

/**
 * Reads one file an index is about to parse, returning undefined when it cannot be read.
 *
 * A file that was listed but cannot be read -- deleted between the listing and the read, or locked
 * -- costs that one file and nothing else. Reading used to sit outside the try in some of these,
 * so one such file rejected the whole build and left the index half-populated for the session.
 */
export async function readIndexFileContent(
	indexName: string,
	file: IndexFile,
	options: { mod?: boolean; hoi4?: boolean },
): Promise<Buffer | undefined> {
	try {
		const [buffer] = await readFileFromModOrHOI4(file.path, options, file.uri);
		return buffer;
	} catch (e) {
		Logger.warn(`${indexName}: can't read ${file.path}: ${e}`);
		return undefined;
	}
}

/**
 * The detail half of a parse-failure log line: the stack where there is one, and something
 * printable in every other case, including a thrown value whose own toString throws.
 *
 * The four indexes each had their own version of this -- one preferred the stack, one logged only
 * the message, one wrapped the whole thing in a UserError and sent it to the debug console, where
 * it never reached the output channel at all. The wording around it stays with each index, because
 * that part is localised and user-facing; only the awkward part is shared.
 */
export function describeParseFailure(cause: unknown): string {
	if (cause instanceof Error) {
		// `||`, not `??`: an Error can carry an empty-string stack, and reporting nothing at all
		// would be worse than reporting the message.
		return cause.stack || cause.message;
	}

	try {
		return String(cause);
	} catch {
		return Object.prototype.toString.call(cause);
	}
}

/**
 * Reports a file that was read but could not be parsed, saying whether it came from the vanilla
 * install or the mod.
 *
 * The message was written out separately by each index, against its own copy of the same three
 * localisation keys -- and the gfx index had no message at all, only a UserError sent to the debug
 * console, which never reached the output channel.
 */
export function reportIndexParseFailure(
	filePath: string,
	options: { hoi4?: boolean },
	cause: unknown,
): void {
	const source = options.hoi4
		? localize("index.vanilla", "[Vanilla]")
		: localize("index.mod", "[Mod]");
	const failure = localize(
		"index.parseFailure",
		"Parsing failed! Please check if the file has issues!",
	);

	Logger.error(
		`${source} ${filePath} ${failure}\n${describeParseFailure(cause)}`,
	);
}
