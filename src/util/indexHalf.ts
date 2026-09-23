import * as vscode from "vscode";
import {
	computeStaleFiles,
	IndexTimer,
	loadCacheManifest,
	loadCacheRecords,
	saveCacheRecords,
	saveCacheManifest,
	captureCacheScope,
	CacheScope,
} from "./indexCache";
import { indexParseQueue, IndexProgress } from "./indexBuild";
import { IndexFile, IndexListing, toIndexFiles } from "./indexListing";
import { FileSourceOptions, readFileFromModOrHOI4 } from "./fileloader";
import { createTimeSlicer } from "./common";
import { localize } from "./i18n";
import { Logger } from "./logger";
import {
	captureModDependencySnapshot,
	isModDependencyGenerationCurrent,
	whenModDependenciesSettled,
} from "./moddependencies";

export interface IndexBuildContext {
	readonly cacheScope: CacheScope;
	readonly dependencyGeneration: number;
	readonly parentModUris: readonly vscode.Uri[];
}

/** Captures all dependency-sensitive inputs once for the complete index build. */
export async function captureIndexBuildContext(): Promise<IndexBuildContext> {
	const snapshot = await captureModDependencySnapshot();
	return {
		cacheScope: captureCacheScope(snapshot.parentModUris),
		dependencyGeneration: snapshot.generation,
		parentModUris: snapshot.parentModUris,
	};
}

const pendingCacheWrites = new Map<string, Promise<void>>();
const cacheGenerations = new Map<string, number>();

function cacheWriteKey(
	cacheName: string,
	scope: CacheScope,
): string | undefined {
	return scope ? `${scope.toString()}\n${cacheName}` : undefined;
}

async function waitForCacheWrite(key: string | undefined): Promise<void> {
	if (key !== undefined) {
		await pendingCacheWrites.get(key);
	}
}

function queueCacheWrite(
	key: string | undefined,
	cacheName: string,
	records: readonly unknown[],
	filePaths: string[],
	mtimes: Map<string, number>,
	version: number,
	scope: CacheScope,
	generation: number | undefined,
): void {
	if (key === undefined) {
		return;
	}

	const previous = pendingCacheWrites.get(key) ?? Promise.resolve();
	const write = previous.then(async () => {
		if (
			generation !== undefined &&
			!isModDependencyGenerationCurrent(generation)
		) {
			return;
		}
		await saveCacheRecords(cacheName, records, scope);
		if (
			generation !== undefined &&
			!isModDependencyGenerationCurrent(generation)
		) {
			return;
		}
		await saveCacheManifest(cacheName, filePaths, mtimes, version, scope);
	});
	const tracked = write.catch((e) => {
		Logger.error(`Cache save failed for ${cacheName}: ${e}`);
	});
	pendingCacheWrites.set(key, tracked);
	void tracked.finally(() => {
		if (pendingCacheWrites.get(key) === tracked) {
			pendingCacheWrites.delete(key);
		}
	});
}

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
 * callbacks cover: `hydrate` puts one cached record back into the live index, and `serialize` hands
 * back the records that should be written. Everything else is here.
 *
 * A cache is a list of small records -- in practice one per indexed file -- rather than one
 * document, so that neither the write nor the load ever holds the whole index as a single string,
 * and both can give the extension host back its event loop as they go.
 */
export interface IndexHalfSpec<TRecord> {
	/** Names the cache files and the timer's phases, e.g. `"gfxIndex.workspace"`. */
	cacheName: string;
	/** Bump to make previously written caches be ignored rather than misread. */
	version: number;
	listFiles: (token: vscode.CancellationToken) => Promise<IndexListing>;
	/**
	 * Restore one cached record unless its file is in `skipFiles` -- those are the files about to be
	 * re-parsed or gone. Called once per record. Throwing here is treated as a corrupt cache, exactly
	 * as a record that fails to parse is, and the build falls back to parsing everything.
	 */
	hydrate: (record: TRecord, skipFiles: Set<string>) => void;
	/** Parses one file into the live index. Reports its own failures and does not throw. */
	parseFile: (file: IndexFile) => Promise<void>;
	/**
	 * The live index as the records it should be cached as. Captured synchronously, but written over
	 * later ticks, so anything an edit or a rebuild mutates in place has to be copied here rather
	 * than referenced.
	 */
	serialize: () => TRecord[];
	/** Rebuild the complete current listing whenever any cached file changed. */
	fullRebuildOnAnyChange?: boolean;
	/** Dependency generation and scope captured before the build listed any files. */
	dependencyGeneration?: number;
	cacheScope?: CacheScope;
}

export async function buildIndexHalf<TRecord>(
	spec: IndexHalfSpec<TRecord>,
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

async function buildIndexHalfWithTimer<TRecord>(
	spec: IndexHalfSpec<TRecord>,
	progress: IndexProgress,
	timer: IndexTimer,
): Promise<void> {
	const { cacheName, version } = spec;

	// A caller with a captured context already waited and supplies the same parent snapshot to the
	// listing and cache namespace. Standalone half builds retain the wait here.
	if (spec.dependencyGeneration === undefined) {
		await whenModDependenciesSettled();
	}

	// The listing runs here rather than in the caller so that the timer covers it. On a desktop
	// install it is now the directory walk and the mtimes together, which is where a slow cold build
	// spends its time, and it used to happen before the timer existed.
	// Captured before the listing so a slow walk never pairs the new namespace with an old one.
	const cacheScope =
		spec.cacheScope !== undefined ? spec.cacheScope : captureCacheScope();
	const writeKey = cacheWriteKey(cacheName, cacheScope);
	const dependencyChanged =
		spec.dependencyGeneration !== undefined &&
		writeKey !== undefined &&
		cacheGenerations.get(writeKey) !== undefined &&
		cacheGenerations.get(writeKey) !== spec.dependencyGeneration;
	if (writeKey !== undefined && spec.dependencyGeneration !== undefined) {
		cacheGenerations.set(writeKey, spec.dependencyGeneration);
	}
	await waitForCacheWrite(writeKey);

	timer.begin("list");
	const { filePaths, uris, mtimes } = await spec.listFiles(progress.token);

	timer.begin("cache");
	const manifest = dependencyChanged
		? null
		: await loadCacheManifest(cacheName, version, cacheScope);
	let filesToParse = filePaths;

	if (manifest) {
		const staleness = computeStaleFiles(manifest, mtimes);
		const hasChanges =
			staleness.stale.length > 0 ||
			staleness.removed.length > 0 ||
			staleness.added.length > 0;

		// Whatever is still fresh gets reused, however much of the listing changed. This used to be
		// gated on stale + removed + added being fewer than the files listed, so a large pull -- or
		// a manifest naming files that have since been deleted, which count towards that sum but
		// not towards the listing -- threw away a cache that was still most of the way good. The
		// stale files have to be parsed either way, so counting them only ever added work.
		// A half that rebuilds on any change has no use for the data then, so it is not even read.
		if (!(spec.fullRebuildOnAnyChange && hasChanges)) {
			try {
				const records = await loadCacheRecords(cacheName, cacheScope);
				if (records) {
					const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
					const slice = createTimeSlicer();
					for (const record of records) {
						spec.hydrate(record as TRecord, skipFiles);
						await slice();
					}
					filesToParse = [...staleness.stale, ...staleness.added];
				}
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

	// Fire-and-forget, but data must finish before the manifest can point readers at it. The payload
	// is captured before a follow-on rebuild resets the live index, and writes are serialized per
	// namespace so an old generation cannot finish after its corrective build.
	queueCacheWrite(
		writeKey,
		cacheName,
		spec.serialize(),
		filePaths,
		mtimes,
		version,
		cacheScope,
		spec.dependencyGeneration,
	);
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
	options: FileSourceOptions,
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
 * install, a parent mod or the mod itself.
 *
 * The message was written out separately by each index, against its own copy of the same three
 * localisation keys -- and the gfx index had no message at all, only a UserError sent to the debug
 * console, which never reached the output channel.
 */
export function reportIndexParseFailure(
	filePath: string,
	options: FileSourceOptions,
	cause: unknown,
): void {
	const source = options.hoi4
		? localize("index.vanilla", "[Vanilla]")
		: options.workspace === false
			? localize("index.parent", "[Parent mod]")
			: localize("index.mod", "[Mod]");
	const failure = localize(
		"index.parseFailure",
		"Parsing failed! Please check if the file has issues!",
	);

	Logger.error(
		`${source} ${filePath} ${failure}\n${describeParseFailure(cause)}`,
	);
}
