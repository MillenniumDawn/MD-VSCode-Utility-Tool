import * as vscode from "vscode";
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

async function openDocumentAtRange(
	document: vscode.TextDocument,
	start: number | undefined,
	end: number | undefined,
	viewColumn: vscode.ViewColumn | undefined,
): Promise<void> {
	await vscode.window.showTextDocument(document, {
		selection:
			start !== undefined && end !== undefined
				? new vscode.Range(document.positionAt(start), document.positionAt(end))
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
			(await vscode.workspace.openTextDocument(filePathInModWithoutOpened));
		await openDocumentAtRange(document, start, end, options.viewColumn);
		return;
	}

	if (!vscode.workspace.workspaceFolders?.length) {
		await vscode.window.showErrorMessage(options.mustOpenFolderMessage);
		return;
	}

	const firstWorkspaceFolder = vscode.workspace.workspaceFolders[0];
	if (firstWorkspaceFolder === undefined) {
		return;
	}
	let targetFolderUri = firstWorkspaceFolder.uri;
	if (vscode.workspace.workspaceFolders.length >= 1) {
		const folder = await vscode.window.showWorkspaceFolderPick({
			placeHolder: options.selectFolderMessage,
		});
		if (!folder) {
			return;
		}

		targetFolderUri = folder.uri;
	}

	try {
		const [buffer] = await readFileFromModOrHOI4(file);
		const targetPath = vscode.Uri.joinPath(targetFolderUri, file);
		await mkdirs(dirUri(targetPath));
		await writeFile(targetPath, buffer);

		const document = await vscode.workspace.openTextDocument(targetPath);
		await openDocumentAtRange(document, start, end, options.viewColumn);
	} catch (e) {
		await vscode.window.showErrorMessage(
			options.failedToOpenMessage(forceError(e).toString()),
		);
	}
}
