import type * as vscode from "vscode";
import { host } from "./host";
import * as fs from "fs";
import * as path from "path";
import { dirUri, getDocumentByUri, mkdirs, writeFile } from "./vsccommon";
import {
	getFilePathFromMod,
	getHoiOpenedFileOriginalUri,
	readFileFromModOrHOI4,
} from "./fileloader";
import { forceError } from "./common";

export interface OpenOrCopyHoiFileOptions {
	viewColumn?: vscode.ViewColumn;
	mustOpenFolderMessage: string;
	selectFolderMessage: string;
	failedToOpenMessage: (errorMessage: string) => string;
}

async function ensureCopyTargetIsInsideWorkspace(
	targetPath: vscode.Uri,
	workspaceRoot: vscode.Uri,
): Promise<void> {
	if (targetPath.scheme !== "file" || workspaceRoot.scheme !== "file") {
		return;
	}

	const resolvedRoot = await new Promise<string>((resolve, reject) =>
		fs.realpath(workspaceRoot.fsPath, (error, resolved) => error ? reject(error) : resolve(resolved)),
	);
	let existingPath = targetPath.fsPath;
	while (true) {
		try {
			existingPath = await new Promise<string>((resolve, reject) =>
				fs.realpath(existingPath, (error, resolved) => error ? reject(error) : resolve(resolved)),
			);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
			const parent = path.dirname(existingPath);
			if (parent === existingPath) {
				break;
			}
			existingPath = parent;
		}
	}

	const relative = path.relative(resolvedRoot, existingPath);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error("Copy target resolves outside the workspace");
	}
}

async function openDocumentAtRange(
	document: vscode.TextDocument,
	start: number | undefined,
	end: number | undefined,
	viewColumn: vscode.ViewColumn | undefined,
): Promise<void> {
	await host().window.showTextDocument(document, {
		selection:
			start !== undefined && end !== undefined
				? new (host().Range)(document.positionAt(start), document.positionAt(end))
				: undefined,
		viewColumn,
	});
}

export async function openOrCopyHoiFile(
	file: string,
	start: number | undefined,
	end: number | undefined,
	options: OpenOrCopyHoiFileOptions,
): Promise<void> {
	const filePathInMod = await getFilePathFromMod(file);
	if (filePathInMod !== undefined) {
		const filePathInModWithoutOpened = getHoiOpenedFileOriginalUri(filePathInMod);
		const document =
			getDocumentByUri(filePathInModWithoutOpened) ??
			(await host().workspace.openTextDocument(filePathInModWithoutOpened));
		await openDocumentAtRange(document, start, end, options.viewColumn);
		return;
	}

	const workspaceFolders = host().workspace.workspaceFolders;
	if (!workspaceFolders?.length) {
		await host().window.showErrorMessage(options.mustOpenFolderMessage);
		return;
	}

	const firstWorkspaceFolder = workspaceFolders[0];
	if (firstWorkspaceFolder === undefined) {
		return;
	}
	let targetFolderUri = firstWorkspaceFolder.uri;
	if (workspaceFolders.length > 1) {
		const folder = await host().window.showWorkspaceFolderPick({
			placeHolder: options.selectFolderMessage,
		});
		if (!folder) {
			return;
		}

		targetFolderUri = folder.uri;
	}

	try {
		const [buffer] = await readFileFromModOrHOI4(file);
		const targetPath = host().Uri.joinPath(targetFolderUri, file);
		await ensureCopyTargetIsInsideWorkspace(targetPath, targetFolderUri);
		await mkdirs(dirUri(targetPath));
		await writeFile(targetPath, buffer);

		const document = await host().workspace.openTextDocument(targetPath);
		await openDocumentAtRange(document, start, end, options.viewColumn);
	} catch (e) {
		await host().window.showErrorMessage(
			options.failedToOpenMessage(forceError(e).toString()),
		);
	}
}
