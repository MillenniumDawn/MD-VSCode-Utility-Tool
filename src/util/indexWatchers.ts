import type * as vscode from "vscode";
import { ConfigurationKey } from "../constants";
import { onDidSelectInstallPath } from "./installpath";
import { host } from "./host";
import * as path from "path";
import { IndexProgress, withIndexProgress } from "./indexBuild";
import { attachTaskWithErrorLogging, BuildGate } from "./promiseUtils";
import { Logger } from "./logger";
import { onDidChangeParentMods, ParentModsChangeEvent } from "./parentmods";

/** The indexed path of a workspace file, or undefined outside the index's roots. */
export function toWorkspaceRelativePath(
	file: vscode.Uri,
	rootPrefixes: string | readonly string[],
): string | undefined {
	const wsFolder = host().workspace.getWorkspaceFolder(file);
	if (!wsFolder) {
		return undefined;
	}
	const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, "/");
	if (!relative) {
		return undefined;
	}
	const prefixes = typeof rootPrefixes === "string" ? [rootPrefixes] : rootPrefixes;
	return prefixes.some((prefix) => relative.startsWith(prefix)) ? relative : undefined;
}

export interface IndexWatcherSpec {
	enabled: () => boolean;
	extension: string;
	acceptsFile?: (file: vscode.Uri) => boolean;
	hasStarted: () => boolean;
	gate: BuildGate;
	reindexFile: (file: vscode.Uri) => void;
	globalSourceChanged?: () => void;
	/** Handles ambiguous file/folder operations without statting paths which may be gone. */
	workspaceOperation?: (kind: "create" | "delete" | "rename", files: readonly vscode.Uri[]) => boolean;
	removeFile: (file: vscode.Uri) => void;
	rebuildWorkspace: {
		reset: () => void;
		build: (progress: IndexProgress) => Promise<void>;
		message: string;
		failureMessage: string;
	};
	rebuildParent?: {
		reset: () => void;
		build: (progress: IndexProgress) => Promise<void>;
	};
}

export interface IndexWatchers {
	register(): vscode.Disposable;
	cancelPending(): void;
	handlers: {
		onChangeConfiguration(e: vscode.ConfigurationChangeEvent): void;
		onChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void;
		onChangeParentMods(e: ParentModsChangeEvent): void;
		onChangeTextDocument(e: vscode.TextDocumentChangeEvent): void;
		onCloseTextDocument(document: vscode.TextDocument): void;
		onCreateFiles(e: vscode.FileCreateEvent): void;
		onDeleteFiles(e: vscode.FileDeleteEvent): void;
		onRenameFiles(e: vscode.FileRenameEvent): void;
	};
}

export function createIndexWatchers(spec: IndexWatcherSpec): IndexWatchers {
	const { extension, hasStarted, gate } = spec;
	const normalizedExtension = extension.toLowerCase();

	function rebuild(halves: readonly {
		reset: () => void;
		build: (progress: IndexProgress) => Promise<void>;
	}[]): void {
		if (!hasStarted()) {
			return;
		}
		const task = gate.followOn(() => {
			for (const half of halves) {
				half.reset();
			}
			return withIndexProgress(spec.rebuildWorkspace.message, (progress) =>
				Promise.all(halves.map((half) => half.build(progress))).then(() => undefined));
		});
		attachTaskWithErrorLogging(task, spec.rebuildWorkspace.failureMessage, Logger.error);
	}

	function onChangeConfiguration(e: vscode.ConfigurationChangeEvent): void {
		if (e.affectsConfiguration(`${ConfigurationKey}.installPath`) ||
			e.affectsConfiguration(`${ConfigurationKey}.loadDlcContents`)) {
			spec.globalSourceChanged?.();
		}
	}

	function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent): void {
		rebuild([spec.rebuildWorkspace]);
	}

	function onChangeParentMods(e: ParentModsChangeEvent): void {
		if (spec.rebuildParent && e.folders) {
			rebuild([spec.rebuildParent]);
		}
	}

	interface PendingFile {
		file: vscode.Uri;
		remove: boolean;
		checkCreate: boolean;
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

	// Editor and filesystem notifications share one queue; the last operation wins.
	function queueFile(file: vscode.Uri, remove: boolean, checkCreate = false): void {
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
			checkCreate: checkCreate || previous?.checkCreate === true,
			firstEvent,
			timer: setTimeout(() => {
				gate.runAfterBuild(() => {
					if (pending.get(key) !== entry) {
						return;
					}
					pending.delete(key);
					if (entry.remove) {
						spec.removeFile(entry.file);
					} else if (!entry.checkCreate || !handlesOperation("create", [entry.file])) {
						spec.reindexFile(entry.file);
					}
				});
			}, Math.max(0, Math.min(1000, 3000 - (Date.now() - firstEvent)))),
		};
		pending.set(key, entry);
	}

	function handlesOperation(kind: "create" | "delete" | "rename", files: readonly vscode.Uri[]): boolean {
		return hasStarted() && spec.workspaceOperation?.(kind, files) === true;
	}

	function onChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
		queueFile(e.document.uri, false);
	}

	function onCloseTextDocument(document: vscode.TextDocument): void {
		if (document.isDirty) {
			queueFile(document.uri, false);
		}
	}

	function onCreateFiles(e: vscode.FileCreateEvent): void {
		for (const file of e.files) {
			if (file.path.toLowerCase().endsWith(normalizedExtension)) {
				queueFile(file, false, true);
			} else {
				handlesOperation("create", [file]);
			}
		}
	}

	function onDeleteFiles(e: vscode.FileDeleteEvent): void {
		if (handlesOperation("delete", e.files)) { return; }
		for (const file of e.files) {
			queueFile(file, true);
		}
	}

	function onRenameFiles(e: vscode.FileRenameEvent): void {
		const moved = e.files.filter((file) => file.oldUri.toString() !== file.newUri.toString());
		if (moved.length > 0 && handlesOperation("rename", moved.flatMap((file) => [file.oldUri, file.newUri]))) { return; }
		for (const file of e.files) {
			queueFile(file.oldUri, true);
			queueFile(file.newUri, false);
		}
	}

	const handlers = {
		onChangeConfiguration,
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
				return (event) => { if (active) { handler(event); } };
			}
			const extensionGlob = normalizedExtension.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`);
			const files = host().workspace.createFileSystemWatcher(`**/*${extensionGlob}`);
			return host().Disposable.from(
				files,
				files.onDidChange(whileRegistered((file) => queueFile(file, false))),
				files.onDidCreate(whileRegistered((file) => queueFile(file, false))),
				files.onDidDelete(whileRegistered((file) => queueFile(file, true))),
				{ dispose: () => { active = false; cancelPending(); } },
				...(spec.globalSourceChanged ? [
					host().workspace.onDidChangeConfiguration(whileRegistered(onChangeConfiguration)),
					onDidSelectInstallPath(() => { if (active) { spec.globalSourceChanged?.(); } }),
				] : []),
				host().workspace.onDidChangeWorkspaceFolders(whileRegistered(onChangeWorkspaceFolders)),
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
