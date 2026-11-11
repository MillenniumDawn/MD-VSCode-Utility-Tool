import type * as vscode from "vscode";
import * as path from "path";
import { host } from "./host";
import { createIndexBuilder, IndexProgress, withIndexProgress } from "./indexBuild";
import { buildIndexHalf, captureIndexBuildContext, IndexBuildContext } from "./indexHalf";
import { IndexFile, listIndexFiles } from "./indexListing";
import { clearDlcZipCache, FileSourceOptions, getFilePathFromModOrHOI4, ListFilesOptions } from "./fileloader";
import { createIndexWatchers, IndexWatchers, toWorkspaceRelativePath } from "./indexWatchers";
import { Logger } from "./logger";
import { attachTaskWithErrorLogging } from "./promiseUtils";

import { indexSourceIdentity } from "./indexCache";

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
	const pendingParses = new Map<string, object>();
	let sourceGeneration = 0;
	let buildAttempt = 0;
	let builtSource: string | undefined;
	let globalTask: Promise<unknown> | undefined;
	let workspaceGeneration = 0;
	let operationGeneration = 0;
	let workspaceLifecycle = 0;
	let workspaceFiles = new Set<string>();
	let workspaceDirty = false;
	const createdFiles = new Map<string, vscode.Uri>();
	let forceWorkspaceRebuild = false;
	let workspaceTask: Promise<unknown> | undefined;
	const rootPrefixes = spec.roots.map((root) => `${root}/`);

	function buildHalf(
		suffix: string,
		half: H,
		options: ListFilesOptions,
		progress: IndexProgress,
		context: IndexBuildContext,
		isCurrent?: () => boolean,
		forceReparse = false,
	): Promise<void> {
		return buildIndexHalf<R>(
			{
				cacheName: `${spec.name}.${suffix}`,
				isCurrent,
				forceReparse,
				version: spec.cacheVersion,
				cacheScope: context.cacheScope,
				dependencyGeneration: context.dependencyGeneration,
				fullRebuildOnAnyChange: spec.fullRebuildOnAnyChange,
				listFiles: async (token) => {
					const listing = await listIndexFiles({
						roots: spec.roots,
						filter: spec.filter,
						options: { ...options, token },
						tolerateRootErrors: spec.tolerateRootErrors,
					});
					if (suffix === "workspace" && (!isCurrent || isCurrent())) {
						workspaceFiles = new Set(listing.filePaths);
					}
					return listing;
				},
				hydrate: (record, skipFiles) => spec.hydrate(half, record, skipFiles),
				parseFile: async (file) => {
					await spec.parseFile(half, file, options);
				},
				serialize: () => spec.serialize(half),
			},
			progress,
		);
	}

	async function buildGlobal(progress: IndexProgress, initialContext?: IndexBuildContext): Promise<void> {
		const attempt = buildAttempt;
		let context = initialContext;
		for (;;) {
			const generation = sourceGeneration;
			const buildContext = context ?? await captureIndexBuildContext();
			context = undefined;
			const isCurrent = () => attempt === buildAttempt && generation === sourceGeneration &&
				buildContext.sourceIdentity === indexSourceIdentity();
			const candidate = spec.newHalf("global");
			try {
				await buildHalf("global", candidate, { mod: false, hoi4: true, recursively: true }, progress, buildContext, isCurrent);
			} catch (cause) {
				if (isCurrent()) { throw cause; }
			}
			// An initial sibling can fail while this half is still running. A later initial
			// attempt owns publication now; the old one must neither publish nor rebuild again.
			if (attempt !== buildAttempt) { return; }
			if (!isCurrent()) {
				// Listing and parsing may straddle a setting change. Never publish or cache that mix.
				continue;
			}
			global = candidate;
			if (globalTask) { spec.changed?.(); }
			builtSource = buildContext.sourceIdentity;
			return;
		}
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
		const generation = workspaceGeneration;
		await buildHalf(
			"workspace",
			workspace,
			{ mod: true, parent: false, hoi4: false, recursively: true },
			progress,
			buildContext,
			() => generation === workspaceGeneration,
		);
	}

	const builder = createIndexBuilder({
		name: spec.name,
		message: spec.message,
		build: async (progress) => {
			pendingParses.clear();
			buildAttempt++;
			const context = await captureIndexBuildContext();
			return Promise.all([
				buildGlobal(progress, context),
				buildParents(progress, context),
				buildWorkspace(progress, context),
			]);
		},
	});

	function globalSourceChanged(): void {
		void clearDlcZipCache();
		if (!builder.hasStarted()) { return; }
		sourceGeneration++;
		global = spec.newHalf("global");
		builtSource = undefined;
		spec.changed?.();
		const task = builder.gate.followOn(() => {
			if (builtSource === indexSourceIdentity()) { return Promise.resolve(); }
			return withIndexProgress(spec.rebuildMessage, (progress) => buildGlobal(progress));
		});
		globalTask = task;
		const clearTask = () => { if (globalTask === task) { globalTask = undefined; } };
		void task.then(clearTask, clearTask);
		attachTaskWithErrorLogging(task, spec.rebuildFailureMessage, Logger.error);
	}

	function overlapsWorkspaceRoot(file: vscode.Uri): boolean {
		const folder = host().workspace.getWorkspaceFolder(file);
		if (!folder) { return false; }
		const relative = path.relative(folder.uri.path, file.path).replace(/\\+/g, "/");
		return spec.roots.some((root) => relative === "" || relative === root ||
			relative.startsWith(`${root}/`) || root.startsWith(`${relative}/`));
	}

	function rebuildWorkspaceAfterOperation(): void {
		operationGeneration++;
		workspaceDirty = true;
		if (workspaceTask) { return; }
		const lifecycle = workspaceLifecycle;
		const task = builder.gate.followOn(() => withIndexProgress(spec.rebuildMessage, async (progress) => {
			while (workspaceDirty) {
				const operation = operationGeneration;
				const creates = [...createdFiles.values()];
				createdFiles.clear();
				let rebuild = forceWorkspaceRebuild;
				forceWorkspaceRebuild = false;
				for (const file of creates) {
					if (!file.path.toLowerCase().endsWith(spec.extension.toLowerCase())) { rebuild = true; continue; }
					try {
						// Only a live create target is statted. Deleted and old rename paths never are.
						if (!((await host().workspace.fs.stat(file)).type & 1)) { rebuild = true; }
					} catch { rebuild = true; }
				}
				if (!workspaceDirty || lifecycle !== workspaceLifecycle) { return; }
				if (operation !== operationGeneration) {
					for (const file of creates) {
						if (!createdFiles.has(file.toString())) { createdFiles.set(file.toString(), file); }
					}
					forceWorkspaceRebuild ||= rebuild;
					continue;
				}
				if (!rebuild) {
					for (const file of creates) {
						if (!workspaceDirty || lifecycle !== workspaceLifecycle) { return; }
						attachTaskWithErrorLogging(reindexFile(file), `Re-indexing ${file.toString()} failed`, Logger.error);
					}
					if (operation === operationGeneration) { workspaceDirty = false; }
					continue;
				}
				// Only a confirmed full refresh supersedes unrelated queued or in-flight edits.
				watchers.cancelPending();
				pendingParses.clear();
				const generation = ++workspaceGeneration;
				const context = await captureIndexBuildContext();
				const candidate = spec.newHalf("workspace");
				const isCurrent = () => generation === workspaceGeneration && operation === operationGeneration && lifecycle === workspaceLifecycle;
				try {
					await buildHalf("workspace", candidate, { mod: true, parent: false, hoi4: false, recursively: true }, progress, context, isCurrent, true);
				} catch (cause) {
					if (isCurrent()) { forceWorkspaceRebuild = true; throw cause; }
				}
				if (!isCurrent()) { forceWorkspaceRebuild = true; continue; }
				workspace = candidate;
				workspaceDirty = false;
				spec.changed?.();
			}
		}));
		workspaceTask = task;
		const clear = () => { if (workspaceTask === task) { workspaceTask = undefined; } };
		void task.then(clear, clear);
		attachTaskWithErrorLogging(task, spec.rebuildFailureMessage, Logger.error);
	}

	function workspaceOperation(kind: "create" | "delete" | "rename", files: readonly vscode.Uri[]): boolean {
		const relevant = files.filter(overlapsWorkspaceRoot);
		if (relevant.length === 0) { return false; }
		// A known file deletion can stay incremental. Every ambiguous path is treated as a
		// possible directory, including directories with names ending in .gfx or .yml.
		if (kind === "delete" && relevant.every((file) => {
			const relative = toWorkspaceRelativePath(file, rootPrefixes);
			return relative !== undefined && workspaceFiles.has(relative);
		})) { return false; }
		if (kind === "rename" && files.every((file, index) => {
			if (index % 2 !== 0) { return true; }
			const relative = toWorkspaceRelativePath(file, rootPrefixes);
			return relative !== undefined && workspaceFiles.has(relative);
		})) { return false; }
		if (kind === "create") {
			for (const file of relevant) { createdFiles.set(file.toString(), file); }
		} else {
			forceWorkspaceRebuild = true;
		}
		rebuildWorkspaceAfterOperation();
		return true;
	}

	async function ensureBuilt(): Promise<void> {
		await builder.ensureBuilt();
		if (!globalTask && builtSource !== indexSourceIdentity()) { globalSourceChanged(); }
		for (;;) {
			if (workspaceDirty && !workspaceTask) { rebuildWorkspaceAfterOperation(); }
			const pending = [globalTask, workspaceTask].filter((task) => task !== undefined);
			if (pending.length === 0) { return; }
			await Promise.all(pending);
		}
	}

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

		// Resolve through workspace precedence, then bypass the content cache: a filesystem event
		// says this file changed even when another preview has kept its cached buffer hot.
		const generation = {};
		pendingParses.set(relative, generation);
		const options = { parent: false, hoi4: false };
		try {
			const uri = await getFilePathFromModOrHOI4(relative, options);
			if (pendingParses.get(relative) !== generation) {
				return;
			}
			const parsed = spec.newHalf("workspace");
			if (!(await spec.parseFile(parsed, { path: relative, uri }, options)) ||
				pendingParses.get(relative) !== generation) {
				return;
			}

			// Read after the parse: a rebuild may have replaced the half in the meantime.
			spec.removeFile(workspace, relative);
			spec.mergeFile(workspace, parsed, relative);
			workspaceFiles.add(relative);
			spec.changed?.();
		} finally {
			if (pendingParses.get(relative) === generation) {
				pendingParses.delete(relative);
			}
		}
	}

	const watchers = createIndexWatchers({
		enabled: spec.enabled,
		globalSourceChanged,
		workspaceOperation,
		extension: spec.extension,
		acceptsFile: (file) => toWorkspaceRelativePath(file, rootPrefixes) !== undefined,
		hasStarted: () => builder.hasStarted(),
		gate: builder.gate,
		reindexFile: (file) => {
			attachTaskWithErrorLogging(reindexFile(file), `Re-indexing ${file.toString()} failed`, Logger.error);
		},
		removeFile: (file) => {
			const relative = toWorkspaceRelativePath(file, rootPrefixes);
			if (relative) {
				pendingParses.delete(relative);
				workspaceFiles.delete(relative);
				spec.removeFile(workspace, relative);
				spec.changed?.();
			}
		},
		rebuildWorkspace: {
			reset: () => {
				pendingParses.clear();
				workspaceGeneration++;
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
		ensureBuilt,
		halves: () => ({ global, parents, workspace }),
		inPrecedence: () => [workspace, ...parents, global],
		register: () => {
			const registration = watchers.register();
			return { dispose: () => {
				registration.dispose();
				pendingParses.clear();
				workspaceGeneration++;
				operationGeneration++;
				workspaceLifecycle++;
				workspaceDirty = false;
				createdFiles.clear();
				forceWorkspaceRebuild = false;
			} };
		},
		handlers: watchers.handlers,
		resetForTests: () => {
			watchers.cancelPending();
			pendingParses.clear();
			builder.reset();
			buildAttempt++;
			sourceGeneration++;
			builtSource = undefined;
			globalTask = undefined;
			workspaceGeneration++;
			operationGeneration++;
			workspaceLifecycle++;
			workspaceFiles = new Set();
			workspaceDirty = false;
			createdFiles.clear();
			forceWorkspaceRebuild = false;
			workspaceTask = undefined;
			global = spec.newHalf("global");
			parents = [];
			workspace = spec.newHalf("workspace");
			spec.changed?.();
		},
	};
}
