import type * as vscode from "vscode";
import { host } from "./host";
import * as path from "path";
import { IndexProgress, withIndexProgress } from "./indexBuild";
import { attachTaskWithErrorLogging, BuildGate } from "./promiseUtils";
import { Logger } from "./logger";
import { onDidChangeParentMods, ParentModsChangeEvent } from "./parentmods";

/**
 * The path a workspace file is indexed under, or undefined when it is outside the workspace or
 * outside every root the index cares about.
 *
 * The four indexes each inlined this, twice over in two of them -- six copies of the same
 * `path.relative(...).replace(...)` and prefix test.
 */
export function toWorkspaceRelativePath(
	file: vscode.Uri,
	rootPrefixes: string | readonly string[],
): string | undefined {
	const wsFolder = host().workspace.getWorkspaceFolder(file);
	if (!wsFolder) {
		return undefined;
	}

	const relative = path
		.relative(wsFolder.uri.path, file.path)
		.replace(/\\+/g, "/");
	if (!relative) {
		return undefined;
	}

	const prefixes =
		typeof rootPrefixes === "string" ? [rootPrefixes] : rootPrefixes;
	return prefixes.some((prefix) => relative.startsWith(prefix))
		? relative
		: undefined;
}

export interface IndexWatcherSpec {
	/** The index's feature flag, read on registration. When false nothing is subscribed at all. */
	enabled: () => boolean;
	/** Files this index cares about, e.g. `".gfx"`. */
	extension: string;
	/** Rejects files outside the roots this index reads. */
	acceptsFile?: (file: vscode.Uri) => boolean;
	/** Incremental events stay inert until something has actually asked for the index. */
	hasStarted: () => boolean;
	/** Defers every mutation below until an in-flight build has settled. */
	gate: BuildGate;
	/** Re-reads one workspace file into the index. */
	reindexFile: (file: vscode.Uri) => void;
	/** Drops one workspace file from the index. */
	removeFile: (file: vscode.Uri) => void;
	/** Everything needed to rebuild the workspace half after the folders changed. */
	rebuildWorkspace: {
		/** Empties the workspace half before the rebuild starts. */
		reset: () => void;
		build: (progress: IndexProgress) => Promise<void>;
		/** Localised, shown in the progress notification. */
		message: string;
		/** Logged if the rebuild fails. */
		failureMessage: string;
	};
	/**
	 * The parent-mod half, rebuilt when the parent list changes. It shares the workspace rebuild's
	 * progress message: to the user it is the same kind of rebuild.
	 */
	rebuildParent?: {
		reset: () => void;
		build: (progress: IndexProgress) => Promise<void>;
	};
}

export interface IndexWatchers {
	/** Subscribes to the workspace events, or to nothing when the flag is off. */
	register(): vscode.Disposable;
	/** Cancels timers and mutations still waiting for a build. */
	cancelPending(): void;
	/**
	 * The same handlers, for tests to drive directly rather than through VS Code. Each index used
	 * to export its own trio of these under the same name and comment.
	 */
	handlers: {
		onChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void;
		/** What a change to the parent list runs: a rebuild of the parent half. */
		onChangeParentMods(e: ParentModsChangeEvent): void;
		onChangeTextDocument(e: vscode.TextDocumentChangeEvent): void;
		onCloseTextDocument(document: vscode.TextDocument): void;
		onCreateFiles(e: vscode.FileCreateEvent): void;
		onDeleteFiles(e: vscode.FileDeleteEvent): void;
		onRenameFiles(e: vscode.FileRenameEvent): void;
	};
}

/*
 * Keeping an index in step with the editor.
 *
 * All four indexes wired up the same six events in the same order and handled them the same way,
 * down to `onRenameFiles` being byte-identical in every one of them. What differed was the file
 * extension and which functions to call, which is what the spec above carries.
 */
export function createIndexWatchers(spec: IndexWatcherSpec): IndexWatchers {
	const { extension, hasStarted, gate } = spec;
	const normalizedExtension = extension.toLowerCase();

	function rebuild(
		halves: readonly {
			reset: () => void;
			build: (progress: IndexProgress) => Promise<void>;
		}[],
	) {
		if (!hasStarted()) {
			return;
		}

		// Reset only after the current build; occupy the gate now so events wait.
		const task = gate.followOn(() => {
			for (const half of halves) {
				half.reset();
			}
			return withIndexProgress(spec.rebuildWorkspace.message, (progress) =>
				Promise.all(
					halves.map((half) => half.build(progress)),
				).then(() => undefined),
			);
		});
		attachTaskWithErrorLogging(
			task,
			spec.rebuildWorkspace.failureMessage,
			Logger.error,
		);
	}

	function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
		rebuild([spec.rebuildWorkspace]);
	}

	// Only the parent half: the workspace half lists the workspace folders alone, so the parents
	// changing leaves it as it was. An index without a parent half has nothing to do, and neither
	// does a change to the unresolved names alone: those name no folder the half reads.
	function onChangeParentMods(e: ParentModsChangeEvent) {
		if (spec.rebuildParent && e.folders) {
			rebuild([spec.rebuildParent]);
		}
	}

	interface PendingFile {
		file: vscode.Uri;
		remove: boolean;
		firstEvent: number;
		timer: ReturnType<typeof setTimeout>;
	}
	const pending = new Map<string, PendingFile>();

	function cancelPending(): void {
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
		}
		pending.clear();
	}

	// Editor and filesystem notifications for the same operation share one queue. The last
	// operation wins, including a delete after an edit or a create after an atomic replacement.
	function queueFile(file: vscode.Uri, remove: boolean): void {
		if (!hasStarted() || !file.path.toLowerCase().endsWith(normalizedExtension) || spec.acceptsFile?.(file) === false) {
			return;
		}
		const key = file.toString();
		const previous = pending.get(key);
		if (previous) {
			clearTimeout(previous.timer);
		}
		const firstEvent = previous?.firstEvent ?? Date.now();
		const entry: PendingFile = {
			file,
			remove,
			firstEvent,
			timer: setTimeout(() => {
				gate.runAfterBuild(() => {
					if (pending.get(key) !== entry) {
						return;
					}
					pending.delete(key);
					if (entry.remove) {
						spec.removeFile(entry.file);
					} else {
						spec.reindexFile(entry.file);
					}
				});
			}, Math.max(0, Math.min(1000, 3000 - (Date.now() - firstEvent)))),
		};
		pending.set(key, entry);
	}

	function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
		queueFile(e.document.uri, false);
	}

	function onCloseTextDocument(document: vscode.TextDocument) {
		if (document.isDirty) {
			queueFile(document.uri, false);
		}
	}

	function onCreateFiles(e: vscode.FileCreateEvent) {
		for (const file of e.files) {
			queueFile(file, false);
		}
	}

	function onDeleteFiles(e: vscode.FileDeleteEvent) {
		for (const file of e.files) {
			queueFile(file, true);
		}
	}

	function onRenameFiles(e: vscode.FileRenameEvent) {
		onDeleteFiles({ files: e.files.map((f) => f.oldUri) });
		onCreateFiles({ files: e.files.map((f) => f.newUri) });
	}

	const handlers = {
		onChangeWorkspaceFolders,
		onChangeParentMods,
		onChangeTextDocument,
		onCloseTextDocument,
		onCreateFiles,
		onDeleteFiles,
		onRenameFiles,
	};

	return {
		register(): vscode.Disposable {
			if (!spec.enabled()) {
				return host().Disposable.from();
			}

			let active = true;
			function whileRegistered<T>(handler: (event: T) => void): (event: T) => void {
				return (event) => {
					if (active) {
						handler(event);
					}
				};
			}
			const extensionGlob = normalizedExtension.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`);
			const files = host().workspace.createFileSystemWatcher(`**/*${extensionGlob}`);
			return host().Disposable.from(
				files,
				files.onDidChange(whileRegistered((file) => queueFile(file, false))),
				files.onDidCreate(whileRegistered((file) => queueFile(file, false))),
				files.onDidDelete(whileRegistered((file) => queueFile(file, true))),
				{ dispose: () => { active = false; cancelPending(); } },
				host().workspace.onDidChangeWorkspaceFolders(whileRegistered(onChangeWorkspaceFolders)),
				// The published list, not the raw setting: it changes once, after the `.mod`
				// dependencies have been resolved against the new setting.
				onDidChangeParentMods(whileRegistered(onChangeParentMods)),
				host().workspace.onDidChangeTextDocument(whileRegistered(onChangeTextDocument)),
				host().workspace.onDidCloseTextDocument(whileRegistered(onCloseTextDocument)),
				host().workspace.onDidCreateFiles(whileRegistered(onCreateFiles)),
				host().workspace.onDidDeleteFiles(whileRegistered(onDeleteFiles)),
				host().workspace.onDidRenameFiles(whileRegistered(onRenameFiles)),
			);
		},
		handlers,
		cancelPending,
	};
}
