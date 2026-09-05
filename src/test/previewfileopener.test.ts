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
		const workspacePath = await fs.promises.mkdtemp(path.join(process.cwd(), "previewfileopener-"));
		const outsidePath = await fs.promises.mkdtemp(path.join(process.cwd(), "previewfileopener-outside-"));
		const linkedDir = path.join(workspacePath, "common", "ideas");
		await fs.promises.mkdir(path.dirname(linkedDir), { recursive: true });
		await fs.promises.symlink(outsidePath, linkedDir, "junction");
		const vscode = await import("vscode");
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			workspaceFolders: [{ uri: vscode.Uri.file(workspacePath) }],
			stat: async (uri: any) => {
				const p = String(uri.path ?? uri.fsPath ?? "").replace(/\\/g, "/");
				if (p.includes("common/ideas/example.txt") && (p.includes("hoi4installpath") || uri.scheme === "hoi4installpath")) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 10 };
				}
				const err = new Error("FileNotFound");
				(err as any).code = "FileNotFound";
				throw err;
			},
			readFile: async () => Buffer.from("ideas = { }"),
			showWorkspaceFolderPick: async () => ({ uri: vscode.Uri.file(workspacePath) }),
			showErrorMessage: async (message: string) => { errors.push(message); },
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

	it("shows an error when the file is not in the mod and no workspace is open", async () => {
		const messages: string[] = [];
		stubVscode({
			showErrorMessage: async (message: string) => {
				messages.push(message);
				return undefined;
			},
		});

		await openOrCopyHoiFile("common/ideas/missing.txt", 0, 10, {
			mustOpenFolderMessage: "Open a folder first",
			selectFolderMessage: "Choose a folder",
			failedToOpenMessage: (error) => `Failed: ${error}`,
		});

		assert.deepStrictEqual(messages, ["Open a folder first"]);
	});
});
