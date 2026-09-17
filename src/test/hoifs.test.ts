import * as assert from "assert";
import * as vscode from "vscode";
import { registerHoiFs } from "../util/hoifs";
import { whenModDependenciesSettled } from "../util/moddependencies";
import { workspaceModFilesCache } from "../util/modfile";
import { getParentModUris, resetParentModsForTest } from "../util/parentmods";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// With `modFile` unset the selected `.mod` is the first one in the workspace folders, so the
// folders changing can change which file the dependencies come from. That change reaches the
// parent list only if hoifs.ts re-resolves on it.
describe("util/hoifs workspace folder change", function () {
	const nodeFs = require("fs/promises") as typeof import("fs/promises");
	const nodePath = require("path") as typeof import("path");
	const nodeOs = require("os") as typeof import("os");

	let root: string;
	let folderChangeHandler:
		| ((e: vscode.WorkspaceFoldersChangeEvent) => void)
		| undefined;
	let registration: vscode.Disposable;

	function realPathOf(uri: unknown): string {
		return String((uri as { fsPath: string }).fsPath);
	}

	async function write(fullPath: string, content: string): Promise<void> {
		await nodeFs.mkdir(nodePath.dirname(fullPath), { recursive: true });
		await nodeFs.writeFile(fullPath, content);
	}

	beforeEach(async function () {
		root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "hoi4fs-"));
		const userDataDir = nodePath.join(root, "userdata");
		const parentDir = nodePath.join(root, "parent");
		await nodeFs.mkdir(parentDir, { recursive: true });
		await write(nodePath.join(userDataDir, "dlc_load.json"), '{"enabled_mods":[]}');
		await write(
			nodePath.join(userDataDir, "mod", "ugc_1.mod"),
			`name="Parent Mod"\npath="${parentDir.replace(/\\/g, "/")}"\n`,
		);
		await write(
			nodePath.join(root, "sub", "descriptor.mod"),
			'name="sub"\ndependencies={ "Parent Mod" }\n',
		);

		folderChangeHandler = undefined;
		resetParentModsForTest();
		workspaceModFilesCache.clear();
		stubVscode({
			configuration: {
				modFile: "",
				installPath: "",
				parentModPaths: [],
				userDataPath: userDataDir,
			},
			workspaceFolders: [{ uri: vscode.Uri.file(nodePath.join(root, "empty")) }],
			onDidChangeWorkspaceFolders: (handler) => {
				folderChangeHandler = handler;
				return { dispose: () => undefined };
			},
			stat: async (uri: unknown) => {
				const stat = await nodeFs.stat(realPathOf(uri));
				return {
					type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
					mtime: stat.mtime.getTime(),
					ctime: stat.birthtime.getTime(),
					size: stat.size,
				};
			},
			readDirectory: async (uri: unknown) => {
				const dirents = await nodeFs.readdir(realPathOf(uri), { withFileTypes: true });
				return dirents.map(
					(dirent) =>
						[
							dirent.name,
							dirent.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
						] as [string, number],
				);
			},
			readFile: async (uri: unknown) => nodeFs.readFile(realPathOf(uri)),
		});
		await nodeFs.mkdir(nodePath.join(root, "empty"), { recursive: true });
		registration = registerHoiFs();
		await whenModDependenciesSettled();
	});

	afterEach(async function () {
		registration.dispose();
		restoreVscodeStubs();
		resetParentModsForTest();
		workspaceModFilesCache.clear();
		await nodeFs.rm(root, { recursive: true, force: true });
	});

	it("re-resolves the dependencies when a folder with a .mod is added", async function () {
		assert.deepStrictEqual(getParentModUris(), []);
		assert.ok(folderChangeHandler, "registerHoiFs subscribes to the workspace folders");

		const added = { uri: vscode.Uri.file(nodePath.join(root, "sub")) } as vscode.WorkspaceFolder;
		stubVscode({
			workspaceFolders: [{ uri: vscode.Uri.file(nodePath.join(root, "empty")) }, added],
		});
		folderChangeHandler({ added: [added], removed: [] });
		await whenModDependenciesSettled();

		assert.deepStrictEqual(
			getParentModUris().map((uri) => nodePath.resolve(realPathOf(uri))),
			[nodePath.resolve(root, "parent")],
		);
	});
});
