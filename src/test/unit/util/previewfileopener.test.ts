import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fileloader from "../../../util/fileloader";
import { openOrCopyHoiFile } from "../../../util/previewfileopener";
import { handOver } from "../host";

interface FakeUri {
	scheme: string;
	path: string;
	fsPath: string;
	with(change: { path?: string }): FakeUri;
	toString(): string;
}

function fakeUri(fsPath: string): FakeUri {
	return {
		scheme: "file",
		path: fsPath,
		fsPath,
		with: (change) => fakeUri(change.path ?? fsPath),
		toString: () => `file://${fsPath}`,
	};
}

describe("util/previewfileopener copy target", () => {
	const originalGetFilePathFromMod = fileloader.getFilePathFromMod;
	const originalReadFile = fileloader.readFileFromModOrHOI4;
	let workspace: string;
	let reads: string[];
	let writes: { path: string; text: string }[];
	let errors: string[];
	let opened: string[];
	let pickerCalls: number;

	before(() => {
		// A mod can live under a dot folder (~/.local/share/Paradox Interactive), so the root has one too.
		workspace = fs.mkdtempSync(path.join(os.tmpdir(), ".previewfileopener-"));
	});

	after(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	beforeEach(() => {
		reads = [];
		writes = [];
		errors = [];
		opened = [];
		pickerCalls = 0;
		// A file only the game has: not in the workspace, readable from the install.
		(fileloader as any).getFilePathFromMod = async () => undefined;
		(fileloader as any).readFileFromModOrHOI4 = async (file: string) => {
			reads.push(file);
			return [Buffer.from("ideas = { }"), fakeUri(path.join("/hoi4", file))];
		};
		handOver({
			Uri: { joinPath: (base: FakeUri, ...parts: string[]) => fakeUri(path.join(base.fsPath, ...parts)) },
			workspace: {
				workspaceFolders: [{ uri: fakeUri(workspace) }, { uri: fakeUri("/second-workspace") }],
				fs: {
					createDirectory: async () => undefined,
					writeFile: async (uri: FakeUri, buffer: Buffer) => {
						writes.push({ path: uri.fsPath, text: buffer.toString() });
					},
				},
				openTextDocument: async (uri: FakeUri) => {
					opened.push(uri.fsPath);
					return { uri };
				},
			},
			window: {
				showWorkspaceFolderPick: async () => {
					pickerCalls++;
					return { uri: fakeUri(workspace) };
				},
				showErrorMessage: async (message: string) => {
					errors.push(message);
					return undefined;
				},
				showTextDocument: async () => undefined,
			},
		});
	});

	afterEach(() => {
		(fileloader as any).getFilePathFromMod = originalGetFilePathFromMod;
		(fileloader as any).readFileFromModOrHOI4 = originalReadFile;
	});

	function navigateTo(file: string): Promise<void> {
		return openOrCopyHoiFile(file, undefined, undefined, {
			mustOpenFolderMessage: "Open a folder first",
			selectFolderMessage: "Choose a folder",
			failedToOpenMessage: (error) => `Failed: ${error}`,
		});
	}

	for (const file of [
		".git/hooks/x",
		".vscode/tasks.json",
		"common\\.hidden\\x.txt",
		"common/ideas/.hidden.txt",
		"./.git/config",
		"common/./.vscode/x.txt",
	]) {
		it(`neither reads nor writes ${file}`, async () => {
			await navigateTo(file);

			assert.deepStrictEqual(reads, []);
			assert.deepStrictEqual(writes, []);
			assert.deepStrictEqual(opened, []);
			assert.strictEqual(pickerCalls, 0);
			assert.deepStrictEqual(errors, ["Failed: Copy target is inside a dot-prefixed path"]);
		});
	}

	it("still copies a vanilla file the workspace does not have", async () => {
		await navigateTo("common/ideas/x.txt");

		const target = path.join(workspace, "common", "ideas", "x.txt");
		assert.deepStrictEqual(reads, ["common/ideas/x.txt"]);
		assert.deepStrictEqual(writes, [{ path: target, text: "ideas = { }" }]);
		assert.deepStrictEqual(opened, [target]);
		assert.deepStrictEqual(errors, []);
	});

	it("neither reads nor writes through a symlink into a dot folder", async () => {
		const hidden = path.join(workspace, ".git", "hooks");
		fs.mkdirSync(hidden, { recursive: true });
		fs.symlinkSync(path.join(workspace, ".git"), path.join(workspace, "alias"), "junction");

		await navigateTo("alias/hooks/x");

		assert.deepStrictEqual(reads, []);
		assert.deepStrictEqual(writes, []);
		assert.deepStrictEqual(opened, []);
		assert.match(errors[0], /Copy target is inside a dot-prefixed path/);
	});

	it("still copies through a symlink into a normal workspace folder", async () => {
		const common = path.join(workspace, "common");
		fs.mkdirSync(common, { recursive: true });
		fs.symlinkSync(common, path.join(workspace, "common-alias"), "junction");

		await navigateTo("common-alias/ideas/x.txt");

		const target = path.join(workspace, "common-alias", "ideas", "x.txt");
		assert.deepStrictEqual(reads, ["common-alias/ideas/x.txt"]);
		assert.deepStrictEqual(writes, [{ path: target, text: "ideas = { }" }]);
		assert.deepStrictEqual(opened, [target]);
		assert.deepStrictEqual(errors, []);
	});

	it("treats a lone dot segment as no segment", async () => {
		await navigateTo("./common/ideas/x.txt");

		assert.deepStrictEqual(
			writes.map((write) => write.path),
			[path.join(workspace, "common", "ideas", "x.txt")],
		);
		assert.deepStrictEqual(errors, []);
	});

	it("leaves a file already in the workspace to open as before", async () => {
		const existing = fakeUri(path.join(workspace, ".vscode", "tasks.json"));
		(fileloader as any).getFilePathFromMod = async () => existing;
		const document = { uri: existing };
		handOver({
			workspace: {
				textDocuments: [document],
				fs: { writeFile: async () => assert.fail("must not write") },
			},
			window: {
				showTextDocument: async (shown: unknown) => {
					opened.push(shown === document ? "existing" : "other");
				},
			},
		});

		await navigateTo(".vscode/tasks.json");

		assert.deepStrictEqual(opened, ["existing"]);
		assert.deepStrictEqual(reads, []);
	});
});
