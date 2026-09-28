import * as assert from "assert";
import * as vscode from "vscode";
import { getIdeaPlaceholderIcon, vanillaIdeaPlaceholderIcon } from "../previewdef/idea/loader";
import { clearDlcZipCache } from "../util/fileloader";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// An idea whose picture does not resolve used to be drawn with gfx/interface/ideas/WIP_idea.dds,
// which only Millennium Dawn has, so every other mod got no icon at all. The game's
// idea_PLACEHOLDER.dds is now the default, and a mod names its own in an idea_placeholder_icon line
// in its .mod file or in the ideaPlaceholderIcon setting. Issue #450.
describe("previewdef/idea/loader placeholder icon", function () {
	let errors: string[];
	let warnings: string[];
	let originalError: (message: string) => void;
	let originalWarn: (message: string) => void;
	let files: Set<string>;
	let modFileCounter = 0;
	const modIcon = "gfx/interface/ideas/WIP_idea.dds";

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/\\/g, "/")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
	}

	function configure(ideaPlaceholderIcon: string, descriptor?: string): void {
		// A fresh .mod per test: the descriptor cache is keyed by its path.
		const modFile = `/ws/ideatest${modFileCounter++}.mod`;
		const modFileContent = descriptor ?? 'name="test"\n';
		files.add(modFile.replace(/^\/ws\//, ""));
		stubVscode({
			configuration: { modFile, installPath: "", loadDlcContents: false, parentModPaths: [], ideaPlaceholderIcon },
			workspaceFolders: [
				{ uri: { fsPath: "/ws", path: "/ws", scheme: "file", toString: () => "file:///ws" } },
			],
			stat: async (uri: any) => {
				if (files.has(rel(uri))) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + rel(uri));
			},
			readFile: async (uri: any) => {
				if (rel(uri) === modFile.replace(/^\/ws\//, "")) {
					return Buffer.from(modFileContent);
				}
				throw new Error("not found: " + rel(uri));
			},
		});
	}

	beforeEach(function () {
		errors = [];
		warnings = [];
		originalError = Logger.error;
		originalWarn = Logger.warn;
		Logger.error = (message: string) => {
			errors.push(message);
		};
		Logger.warn = (message: string) => {
			warnings.push(message);
		};
		files = new Set<string>([vanillaIdeaPlaceholderIcon]);
	});

	afterEach(async function () {
		Logger.error = originalError;
		Logger.warn = originalWarn;
		restoreVscodeStubs();
		await clearDlcZipCache();
	});

	it("draws the game's idea_PLACEHOLDER.dds by default", async function () {
		files.add(modIcon);
		configure("");
		assert.strictEqual(await getIdeaPlaceholderIcon(), vanillaIdeaPlaceholderIcon);
		assert.deepStrictEqual(warnings, []);
		assert.deepStrictEqual(errors, []);
	});

	it("draws the image the setting names", async function () {
		files.add(modIcon);
		configure("gfx\\interface\\ideas\\WIP_idea.dds");
		assert.strictEqual(await getIdeaPlaceholderIcon(), modIcon);
		assert.deepStrictEqual(errors, []);
	});

	it("draws the image the .mod file names, ahead of the setting", async function () {
		files.add(modIcon);
		files.add("gfx/interface/ideas/other.dds");
		configure("gfx/interface/ideas/other.dds", `name="test"\nidea_placeholder_icon = "${modIcon}"\n`);
		assert.strictEqual(await getIdeaPlaceholderIcon(), modIcon);
		assert.deepStrictEqual(errors, []);
	});

	it("warns once about a configured image that does not exist and falls back to the game's", async function () {
		configure(modIcon);
		assert.strictEqual(await getIdeaPlaceholderIcon(), vanillaIdeaPlaceholderIcon);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].includes("mdHoi4Utilities.ideaPlaceholderIcon"), warnings[0]);
		assert.deepStrictEqual(errors, []);
	});
});
