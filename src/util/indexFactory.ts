import type * as vscode from "vscode";
import { createIndexBuilder, IndexProgress } from "./indexBuild";
import { buildIndexHalf, captureIndexBuildContext, IndexBuildContext } from "./indexHalf";
import { IndexFile, listIndexFiles } from "./indexListing";
import { FileSourceOptions, ListFilesOptions } from "./fileloader";
import { createIndexWatchers, IndexWatchers, toWorkspaceRelativePath } from "./indexWatchers";

/*
 * The skeleton every index shares: three halves -- vanilla, each parent mod, the workspace -- built
 * once, lazily, through the shared builder, then kept in step with the editor by the shared
 * watchers. indexHalf.ts and indexWatchers.ts already held the parts; each index still wired them
 * together in the same hundred lines, so a change to how parents are listed or how a re-index swaps
 * entries had to be made four times.
 *
 * An index supplies its data shape and what to do with one file. Everything else is here.
 */

type IndexSource = "global" | "parent" | "workspace";

export interface ThreeHalfIndexSpec<H, R> {
	/** Names the build in the logs and every cache file: `${name}.global` and so on. */
	name: string;
	/** Localised; names the first build in the progress notification. */
	message: string;
	/** Localised; names a rebuild of the workspace or parent half after the folders changed. */
	rebuildMessage: string;
	/** Logged when such a rebuild fails. */
	rebuildFailureMessage: string;
	/** The index's feature flag, read when the watchers register. */
	enabled: () => boolean;
	/** The folders the index reads, in the order their files should appear. */
	roots: string[];
	/** Applied to a listed name relative to its root. */
	filter?: (relativePath: string) => boolean;
	/** List a root a source does not have as empty, rather than failing the whole build. */
	tolerateRootErrors?: boolean;
	/** Files whose edits re-index them, e.g. `".gfx"`. */
	extension: string;
	/** Bump to make previously written caches be ignored rather than misread. */
	cacheVersion: number;
	fullRebuildOnAnyChange?: boolean;
	newHalf: (source: IndexSource) => H;
	hydrate: (half: H, record: R, skipFiles: Set<string>) => void;
	/** Parses one file into `half`. Returns whether it was read and parsed. */
	parseFile: (half: H, file: IndexFile, options: FileSourceOptions) => Promise<boolean>;
	serialize: (half: H) => R[];
	/** Drops one file from the workspace half. */
	removeFile: (workspace: H, relative: string) => void;
	/** Moves one file's freshly parsed entries from `parsed` into the workspace half. */
	mergeFile: (workspace: H, parsed: H, relative: string) => void;
	/** Runs after any change this skeleton makes to a half, for an index that versions its data. */
	changed?: () => void;
}

export interface ThreeHalfIndex<H> {
	/** Starts the build on the first call; every later call awaits the same one. */
	ensureBuilt(): Promise<unknown>;
	halves(): { global: H; parents: readonly H[]; workspace: H };
	/** The game's order: the working mod, then the mods it extends, then vanilla. */
	inPrecedence(): H[];
	/** Subscribes to the workspace events, or to nothing when the flag is off. */
	register(): vscode.Disposable;
	/** The event handlers, for tests to drive directly. */
	handlers: IndexWatchers["handlers"];
	/** Test-only: drops the build and empties every half. */
	resetForTests(): void;
}

export function createThreeHalfIndex<H, R>(spec: ThreeHalfIndexSpec<H, R>): ThreeHalfIndex<H> {
	let global = spec.newHalf("global");
	let parents: H[] = [];
	let workspace = spec.newHalf("workspace");
	const rootPrefixes = spec.roots.map((root) => `${root}/`);

	function buildHalf(
		suffix: string,
		half: H,
		options: ListFilesOptions,
		progress: IndexProgress,
		context: IndexBuildContext,
	): Promise<void> {
		return buildIndexHalf<R>(
			{
				cacheName: `${spec.name}.${suffix}`,
				version: spec.cacheVersion,
				cacheScope: context.cacheScope,
				dependencyGeneration: context.dependencyGeneration,
				fullRebuildOnAnyChange: spec.fullRebuildOnAnyChange,
				listFiles: (token) =>
					listIndexFiles({
						roots: spec.roots,
						filter: spec.filter,
						options: { ...options, token },
						tolerateRootErrors: spec.tolerateRootErrors,
					}),
				hydrate: (record, skipFiles) => spec.hydrate(half, record, skipFiles),
				parseFile: async (file) => {
					await spec.parseFile(half, file, options);
				},
				serialize: () => spec.serialize(half),
			},
			progress,
		);
	}

	function buildGlobal(progress: IndexProgress, context: IndexBuildContext): Promise<void> {
		return buildHalf("global", global, { mod: false, hoi4: true, recursively: true }, progress, context);
	}

	async function buildParents(progress: IndexProgress, context?: IndexBuildContext): Promise<void> {
		const buildContext = context ?? (await captureIndexBuildContext());
		const parentUris = buildContext.parentModUris;
		parents = parentUris.map(() => spec.newHalf("parent"));
		// No parents, no half: a mod that extends nothing pays no listing and writes no cache for it.
		if (parentUris.length === 0) {
			return;
		}
		await Promise.all(
			parentUris.map((parent, index) =>
				buildHalf(
					`parent.${index}`,
					parents[index]!,
					{ workspace: false, hoi4: false, recursively: true, parentModUris: [parent] },
					progress,
					buildContext,
				),
			),
		);
	}

	async function buildWorkspace(progress: IndexProgress, context?: IndexBuildContext): Promise<void> {
		const buildContext = context ?? (await captureIndexBuildContext());
		await buildHalf(
			"workspace",
			workspace,
			{ mod: true, parent: false, hoi4: false, recursively: true },
			progress,
			buildContext,
		);
	}

	const builder = createIndexBuilder({
		name: spec.name,
		message: spec.message,
		build: async (progress) => {
			const context = await captureIndexBuildContext();
			return Promise.all([
				buildGlobal(progress, context),
				buildParents(progress, context),
				buildWorkspace(progress, context),
			]);
		},
	});

	/**
	 * Re-indexes an edited workspace file: parse first, swap the entry in afterwards.
	 *
	 * Clearing the entry up front -- what an edit used to do -- left everything the file defines
	 * unresolvable for as long as the re-parse took, and a preview refreshing in that window, which
	 * the same edit triggers on the same debounce, drew it as missing. A file that fails to parse
	 * midway through an edit keeps what it was last indexed with.
	 */
	async function reindexFile(file: vscode.Uri): Promise<void> {
		const relative = toWorkspaceRelativePath(file, rootPrefixes);
		if (!relative) {
			return;
		}

		// No URI: a re-index reaches one file, so resolving it the usual way costs nothing. Workspace
		// only: a re-index that fires after the file was deleted must not read the parent's copy into
		// this half, which is the one half the parent's files are never in.
		const parsed = spec.newHalf("workspace");
		if (!(await spec.parseFile(parsed, { path: relative }, { parent: false, hoi4: false }))) {
			return;
		}

		// Read after the parse: a rebuild may have replaced the half in the meantime.
		spec.removeFile(workspace, relative);
		spec.mergeFile(workspace, parsed, relative);
		spec.changed?.();
	}

	const watchers = createIndexWatchers({
		enabled: spec.enabled,
		extension: spec.extension,
		hasStarted: () => builder.hasStarted(),
		gate: builder.gate,
		reindexFile: (file) => {
			void reindexFile(file);
		},
		removeFile: (file) => {
			const relative = toWorkspaceRelativePath(file, rootPrefixes);
			if (relative) {
				spec.removeFile(workspace, relative);
				spec.changed?.();
			}
		},
		rebuildWorkspace: {
			reset: () => {
				workspace = spec.newHalf("workspace");
				spec.changed?.();
			},
			build: buildWorkspace,
			message: spec.rebuildMessage,
			failureMessage: spec.rebuildFailureMessage,
		},
		rebuildParent: {
			reset: () => {
				parents = [];
				spec.changed?.();
			},
			build: buildParents,
		},
	});

	return {
		ensureBuilt: () => builder.ensureBuilt(),
		halves: () => ({ global, parents, workspace }),
		inPrecedence: () => [workspace, ...parents, global],
		register: () => watchers.register(),
		handlers: watchers.handlers,
		resetForTests: () => {
			builder.reset();
			global = spec.newHalf("global");
			parents = [];
			workspace = spec.newHalf("workspace");
			spec.changed?.();
		},
	};
}
