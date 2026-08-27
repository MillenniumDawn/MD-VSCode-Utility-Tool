import * as vscode from "vscode";
import * as path from "path";
import { debounceByInput } from "./common";
import { IndexProgress, withIndexProgress } from "./indexBuild";
import { attachTaskWithErrorLogging, BuildGate } from "./promiseUtils";
import { Logger } from "./logger";
import { sendEvent } from "./telemetry";

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
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
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
	/** The index's feature flag. When false nothing is subscribed at all. */
	enabled: boolean;
	/** Files this index cares about, e.g. `".gfx"`. */
	extension: string;
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
		build: (size: [number], progress: IndexProgress) => Promise<void>;
		/** Localised, shown in the progress notification. */
		message: string;
		/** Telemetry event name, e.g. `"gfxIndex.workspace"`. */
		telemetryEvent: string;
		/** Logged if the rebuild fails. */
		failureMessage: string;
	};
}

export interface IndexWatchers {
	/** Subscribes to the workspace events, or to nothing when the flag is off. */
	register(): vscode.Disposable;
	/**
	 * The same handlers, for tests to drive directly rather than through VS Code. Each index used
	 * to export its own trio of these under the same name and comment.
	 */
	handlers: {
		onChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void;
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

	function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
		if (!hasStarted()) {
			return;
		}

		const folderChangeSize: [number] = [0];
		// Reset only after the current build; occupy the gate now so events wait.
		const task = gate.followOn(() => {
			spec.rebuildWorkspace.reset();
			return withIndexProgress(spec.rebuildWorkspace.message, (progress) =>
				spec.rebuildWorkspace.build(folderChangeSize, progress),
			);
		});
		attachTaskWithErrorLogging(
			task,
			() => {
				sendEvent(spec.rebuildWorkspace.telemetryEvent, {
					size: folderChangeSize[0].toString(),
				});
			},
			spec.rebuildWorkspace.failureMessage,
			Logger.error,
		);
	}

	// Debounced per file: an edit fires one of these per keystroke, and re-reading the file for
	// each would spend the whole typing pause parsing.
	const reindexAfterEdit = debounceByInput(
		(file: vscode.Uri) => {
			gate.runAfterBuild(() => {
				spec.reindexFile(file);
			});
		},
		(file) => file.toString(),
		1000,
		{ trailing: true },
	);

	function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
		if (!hasStarted()) {
			return;
		}

		const file = e.document.uri;
		if (file.path.endsWith(extension)) {
			reindexAfterEdit(file);
		}
	}

	function onCloseTextDocument(document: vscode.TextDocument) {
		if (!hasStarted()) {
			return;
		}

		// Only when dirty: closing without saving reverts the file on disk, so what is indexed has
		// to go back to matching it.
		const file = document.uri;
		if (file.path.endsWith(extension) && document.isDirty) {
			gate.runAfterBuild(() => {
				spec.reindexFile(file);
			});
		}
	}

	function onCreateFiles(e: vscode.FileCreateEvent) {
		if (!hasStarted()) {
			return;
		}

		gate.runAfterBuild(() => {
			for (const file of e.files) {
				if (file.path.endsWith(extension)) {
					spec.reindexFile(file);
				}
			}
		});
	}

	function onDeleteFiles(e: vscode.FileDeleteEvent) {
		if (!hasStarted()) {
			return;
		}

		gate.runAfterBuild(() => {
			for (const file of e.files) {
				if (file.path.endsWith(extension)) {
					spec.removeFile(file);
				}
			}
		});
	}

	function onRenameFiles(e: vscode.FileRenameEvent) {
		onDeleteFiles({ files: e.files.map((f) => f.oldUri) });
		onCreateFiles({ files: e.files.map((f) => f.newUri) });
	}

	const handlers = {
		onChangeWorkspaceFolders,
		onChangeTextDocument,
		onCloseTextDocument,
		onCreateFiles,
		onDeleteFiles,
		onRenameFiles,
	};

	return {
		register(): vscode.Disposable {
			if (!spec.enabled) {
				return vscode.Disposable.from();
			}

			return vscode.Disposable.from(
				vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders),
				vscode.workspace.onDidChangeTextDocument(onChangeTextDocument),
				vscode.workspace.onDidCloseTextDocument(onCloseTextDocument),
				vscode.workspace.onDidCreateFiles(onCreateFiles),
				vscode.workspace.onDidDeleteFiles(onDeleteFiles),
				vscode.workspace.onDidRenameFiles(onRenameFiles),
			);
		},
		handlers,
	};
}
