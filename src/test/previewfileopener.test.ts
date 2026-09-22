import * as assert from "assert";
import { afterEach, describe, it } from "mocha";
import * as path from "path";
import * as fs from "fs";
import { openOrCopyHoiFile } from "../util/previewfileopener";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

describe("util/previewfileopener", () => {
	afterEach(() => {
		restoreVscodeStubs();
	});

	it("rejects a copy whose existing destination is a symlink outside the workspace", async () => {
		const errors: string[] = [];
		const workspacePath = await fs.promises.mkdtemp(
			path.join(process.cwd(), "previewfileopener-"),
		);
		const outsidePath = await fs.promises.mkdtemp(
			path.join(process.cwd(), "previewfileopener-outside-"),
		);
		const linkedDir = path.join(workspacePath, "common", "ideas");
		await fs.promises.mkdir(path.dirname(linkedDir), { recursive: true });
		await fs.promises.symlink(outsidePath, linkedDir, "junction");
		const vscode = await import("vscode");
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			workspaceFolders: [{ uri: vscode.Uri.file(workspacePath) }],
			stat: async (uri: any) => {
				const p = String(uri.path ?? uri.fsPath ?? "").replace(/\\/g, "/");
				if (
					p.includes("common/ideas/example.txt") &&
					(p.includes("hoi4installpath") || uri.scheme === "hoi4installpath")
				) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 10 };
				}
				const err = new Error("FileNotFound");
				(err as any).code = "FileNotFound";
				throw err;
			},
			readFile: async () => Buffer.from("ideas = { }"),
			showWorkspaceFolderPick: async () => ({
				uri: vscode.Uri.file(workspacePath),
			}),
			showErrorMessage: async (message: string) => {
				errors.push(message);
			},
		});
		try {
			await openOrCopyHoiFile("common/ideas/example.txt", 0, 1, {
				mustOpenFolderMessage: "Open a folder first",
				selectFolderMessage: "Choose a folder",
				failedToOpenMessage: (error) => `Failed: ${error}`,
			});
		} finally {
			await fs.promises.rm(workspacePath, { recursive: true, force: true });
			await fs.promises.rm(outsidePath, { recursive: true, force: true });
		}
		assert.strictEqual(errors.length, 1);
		assert.match(errors[0], /Copy target resolves outside the workspace/);
	});

	it("copies directly to the only workspace folder without prompting and keeps the selection", async () => {
		const workspacePath = process.cwd();
		const created: string[] = [];
		const written: string[] = [];
		const shown: any[] = [];
		let pickerCalls = 0;
		const vscode = await import("vscode");
		const originalShowTextDocument = (vscode.window as any).showTextDocument;
		(vscode.window as any).showTextDocument = async (
			document: any,
			options: any,
		) => {
			shown.push({ document, options });
		};
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			workspaceFolders: [{ uri: vscode.Uri.file(workspacePath) }],
			stat: async (uri: any) => {
				const target = String(uri.path ?? uri.fsPath ?? "");
				if (
					target.includes("hoi4installpath") &&
					target.includes("single-folder.txt")
				) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 10 };
				}
				const error = new Error("FileNotFound");
				(error as any).code = "FileNotFound";
				throw error;
			},
			readFile: async () => Buffer.from("ideas = { }"),
			createDirectory: async (uri: any) => {
				created.push(String(uri.fsPath ?? uri.path ?? ""));
			},
			writeFile: async (uri: any) => {
				written.push(String(uri.fsPath ?? uri.path ?? ""));
			},
			openTextDocument: async (uri: any) => ({
				uri,
				positionAt: (offset: number) => ({ offset }),
			}),
			showWorkspaceFolderPick: async () => {
				pickerCalls++;
				return undefined;
			},
		});

		try {
			await openOrCopyHoiFile("common/ideas/single-folder.txt", 2, 7, {
				mustOpenFolderMessage: "Open a folder first",
				selectFolderMessage: "Choose a folder",
				failedToOpenMessage: (error) => `Failed: ${error}`,
				viewColumn: vscode.ViewColumn.Beside,
			});
		} finally {
			(vscode.window as any).showTextDocument = originalShowTextDocument;
		}

		const targetPath = path.join(
			workspacePath,
			"common",
			"ideas",
			"single-folder.txt",
		);
		assert.strictEqual(pickerCalls, 0);
		assert.deepStrictEqual(created, [path.dirname(targetPath)]);
		assert.deepStrictEqual(written, [targetPath]);
		assert.strictEqual(shown.length, 1);
		assert.strictEqual(shown[0].document.uri.fsPath, targetPath);
		assert.deepStrictEqual(shown[0].options.selection.start, { offset: 2 });
		assert.deepStrictEqual(shown[0].options.selection.end, { offset: 7 });
		assert.strictEqual(shown[0].options.viewColumn, vscode.ViewColumn.Beside);
	});

	it("prompts for and copies to the selected workspace folder when several are open", async () => {
		const firstWorkspacePath = process.cwd();
		const selectedWorkspacePath = path.join(process.cwd(), "src");
		const created: string[] = [];
		const written: string[] = [];
		let pickerCalls = 0;
		const shown: any[] = [];
		const vscode = await import("vscode");
		const originalShowTextDocument = (vscode.window as any).showTextDocument;
		(vscode.window as any).showTextDocument = async (
			document: any,
			options: any,
		) => {
			shown.push({ document, options });
		};
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			workspaceFolders: [
				{ uri: vscode.Uri.file(firstWorkspacePath) },
				{ uri: vscode.Uri.file(selectedWorkspacePath) },
			],
			stat: async (uri: any) => {
				const target = String(uri.path ?? uri.fsPath ?? "");
				if (
					target.includes("hoi4installpath") &&
					target.includes("multiple-folders.txt")
				) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 10 };
				}
				const error = new Error("FileNotFound");
				(error as any).code = "FileNotFound";
				throw error;
			},
			readFile: async () => Buffer.from("ideas = { }"),
			createDirectory: async (uri: any) => {
				created.push(String(uri.fsPath ?? uri.path ?? ""));
			},
			writeFile: async (uri: any) => {
				written.push(String(uri.fsPath ?? uri.path ?? ""));
			},
			openTextDocument: async (uri: any) => ({
				uri,
				positionAt: (offset: number) => ({ offset }),
			}),
			showWorkspaceFolderPick: async () => {
				pickerCalls++;
				return { uri: vscode.Uri.file(selectedWorkspacePath) };
			},
		});

		try {
			await openOrCopyHoiFile("common/ideas/multiple-folders.txt", 3, 8, {
				mustOpenFolderMessage: "Open a folder first",
				selectFolderMessage: "Choose a folder",
				failedToOpenMessage: (error) => `Failed: ${error}`,
			});
		} finally {
			(vscode.window as any).showTextDocument = originalShowTextDocument;
		}

		const targetPath = path.join(
			selectedWorkspacePath,
			"common",
			"ideas",
			"multiple-folders.txt",
		);
		assert.strictEqual(pickerCalls, 1);
		assert.deepStrictEqual(created, [path.dirname(targetPath)]);
		assert.deepStrictEqual(written, [targetPath]);
		assert.strictEqual(shown.length, 1);
		assert.strictEqual(shown[0].document.uri.fsPath, targetPath);
		assert.deepStrictEqual(shown[0].options.selection.start, { offset: 3 });
		assert.deepStrictEqual(shown[0].options.selection.end, { offset: 8 });
	});

	it("does not copy when the workspace folder picker is cancelled", async () => {
		let pickerCalls = 0;
		const created: string[] = [];
		const written: string[] = [];
		const opened: string[] = [];
		const vscode = await import("vscode");
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			workspaceFolders: [
				{ uri: vscode.Uri.file("/first-workspace") },
				{ uri: vscode.Uri.file("/second-workspace") },
			],
			stat: async () => {
				const error = new Error("FileNotFound");
				(error as any).code = "FileNotFound";
				throw error;
			},
			readFile: async () => {
				throw new Error("The picker should prevent reading the source file");
			},
			createDirectory: async (uri: any) => {
				created.push(String(uri.fsPath ?? uri.path ?? ""));
			},
			writeFile: async (uri: any) => {
				written.push(String(uri.fsPath ?? uri.path ?? ""));
			},
			openTextDocument: async (uri: any) => {
				opened.push(String(uri.fsPath ?? uri.path ?? ""));
				return { uri, positionAt: () => ({}) };
			},
			showWorkspaceFolderPick: async () => {
				pickerCalls++;
				return undefined;
			},
		});

		await openOrCopyHoiFile("common/ideas/cancelled-picker.txt", 0, 10, {
			mustOpenFolderMessage: "Open a folder first",
			selectFolderMessage: "Choose a folder",
			failedToOpenMessage: (error) => `Failed: ${error}`,
		});

		assert.strictEqual(pickerCalls, 1);
		assert.deepStrictEqual(created, []);
		assert.deepStrictEqual(written, []);
		assert.deepStrictEqual(opened, []);
	});

	it("shows an error without prompting or copying when no workspace is open", async () => {
		const messages: string[] = [];
		let pickerCalls = 0;
		stubVscode({
			showErrorMessage: async (message: string) => {
				messages.push(message);
				return undefined;
			},
			showWorkspaceFolderPick: async () => {
				pickerCalls++;
				return undefined;
			},
		});

		await openOrCopyHoiFile("common/ideas/missing.txt", 0, 10, {
			mustOpenFolderMessage: "Open a folder first",
			selectFolderMessage: "Choose a folder",
			failedToOpenMessage: (error) => `Failed: ${error}`,
		});

		assert.deepStrictEqual(messages, ["Open a folder first"]);
		assert.strictEqual(pickerCalls, 0);
	});

	// The click target is a `file=` attribute the mod's own data wrote, so a hostile mod can point
	// it above the workspace. Every stub here says yes -- the file exists, the folder is picked --
	// so the only thing that can stop it is the resolver refusing the path.
	it("neither opens nor copies a file whose path escapes the workspace", async () => {
		const errors: string[] = [];
		const opened: string[] = [];
		const written: string[] = [];
		const vscode = await import("vscode");
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			workspaceFolders: [{ uri: vscode.Uri.file("/ws") }],
			stat: async () => ({
				type: vscode.FileType.File,
				mtime: 1,
				ctime: 0,
				size: 10,
			}),
			readFile: async () => Buffer.from("secret"),
			writeFile: async (uri: any) => {
				written.push(String(uri.path ?? uri.fsPath ?? ""));
			},
			openTextDocument: async (uri: any) => {
				opened.push(String(uri.path ?? uri.fsPath ?? uri));
				return { uri, getText: () => "", positionAt: () => ({}) };
			},
			showWorkspaceFolderPick: async () => ({ uri: vscode.Uri.file("/ws") }),
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined;
			},
		});

		await openOrCopyHoiFile("../../../../etc/passwd", 0, 1, {
			mustOpenFolderMessage: "Open a folder first",
			selectFolderMessage: "Choose a folder",
			failedToOpenMessage: (error) => `Failed: ${error}`,
		});

		assert.deepStrictEqual(opened, []);
		assert.deepStrictEqual(written, []);
		assert.strictEqual(errors.length, 1);
		assert.match(errors[0], /Can't find file/);
	});
});
