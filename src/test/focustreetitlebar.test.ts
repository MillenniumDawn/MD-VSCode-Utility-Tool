import * as assert from "assert";
import * as vscode from "vscode";
import { loadFocusTitlebarStyles, focusTitlebarStylesFile } from "../previewdef/focustree/titlebar";
import { clearDlcZipCache } from "../util/fileloader";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// A titlebar styles file that fails to read used to disable every focus text icon with no trace.
// The failure now names the file in the HOI4 Modding channel (issue #182).
describe("previewdef/focustree/titlebar loadFocusTitlebarStyles", function () {
	let errors: string[];
	let originalError: (message: string) => void;
	let content: string | undefined;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
	}

	beforeEach(function () {
		errors = [];
		originalError = Logger.error;
		Logger.error = (message: string) => {
			errors.push(message);
		};
		content = undefined;
		stubVscode({
			configuration: { modFile: "", installPath: "", loadDlcContents: false },
			workspaceFolders: [
				{
					uri: {
						fsPath: "/ws",
						path: "/ws",
						scheme: "file",
						toString: () => "file:///ws",
					},
				},
			],
			stat: async (uri: any) => {
				if (content !== undefined && rel(uri) === focusTitlebarStylesFile) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + rel(uri));
			},
			readFile: async (uri: any) => {
				if (content !== undefined && rel(uri) === focusTitlebarStylesFile) {
					return Buffer.from(content);
				}
				throw new Error("not found: " + rel(uri));
			},
		});
	});

	afterEach(async function () {
		Logger.error = originalError;
		restoreVscodeStubs();
		await clearDlcZipCache();
	});

	it("maps each style name to its sprite", async function () {
		content = 'style = { name = "gold" available = "GFX_focus_titlebar_gold" }';
		assert.deepStrictEqual(await loadFocusTitlebarStyles(), { gold: "GFX_focus_titlebar_gold" });
		assert.deepStrictEqual(errors, []);
	});

	it("logs an error naming the file when it does not parse, and disables the icons", async function () {
		content = 'style = { name = "gold" available = "GFX_focus_titlebar_gold" } }';
		assert.deepStrictEqual(await loadFocusTitlebarStyles(), {});
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0].includes(focusTitlebarStylesFile), errors[0]);
	});

	it("logs an error naming the file when it cannot be read", async function () {
		assert.deepStrictEqual(await loadFocusTitlebarStyles(), {});
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0].includes(focusTitlebarStylesFile), errors[0]);
	});
});
