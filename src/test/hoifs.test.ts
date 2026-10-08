import * as assert from "assert";
import * as vscode from "vscode";
import { registerHoiFs } from "../util/hoifs";
import { whenModDependenciesSettled } from "../util/moddependencies";
import { workspaceModFilesCache } from "../util/modfile";
import { getParentModUris, resetParentModsForTest } from "../util/parentmods";
import { clearInstallPathCache, getInstallPathUri } from "../util/installpath";
import { fireConfigurationChange, stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// With `modFile` unset the selected `.mod` is the first one in the workspace folders, so the
// folders changing can change which file the dependencies come from. That change reaches the
// parent list only if hoifs.ts re-resolves on it.
describe("util/hoifs workspace folder and configuration change", function () {
	const nodeFs = require("fs/promises") as typeof import("fs/promises");
	const nodePath = require("path") as typeof import("path");
	const nodeOs = require("os") as typeof import("os");

	let root: string;
	let folderChangeHandler:
		| ((e: vscode.WorkspaceFoldersChangeEvent) => void)
		| undefined;
	let registration: vscode.Disposable;
	let userDataDir: string;
	let errors: string[];
	let fsProvider: vscode.FileSystemProvider | undefined;

	function configure(values: Record<string, unknown>): void {
		stubVscode({
			configuration: {
				modFile: "",
				installPath: "",
				parentModPaths: [],
				userDataPath: userDataDir,
				...values,
			},
		});
	}

	async function until(condition: () => boolean, what: string): Promise<void> {
		for (let i = 0; i < 100 && !condition(); i++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.ok(condition(), what);
	}

	function realPathOf(uri: unknown): string {
		return String((uri as { fsPath: string }).fsPath);
	}

	async function write(fullPath: string, content: string): Promise<void> {
		await nodeFs.mkdir(nodePath.dirname(fullPath), { recursive: true });
		await nodeFs.writeFile(fullPath, content);
	}

	beforeEach(async function () {
		root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "hoi4fs-"));
		userDataDir = nodePath.join(root, "userdata");
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
		fsProvider = undefined;
		errors = [];
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
			registerFileSystemProvider: (_scheme: string, provider: vscode.FileSystemProvider) => {
				fsProvider = provider;
				return { dispose: () => undefined };
			},
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined;
			},
		});
		await nodeFs.mkdir(nodePath.join(root, "empty"), { recursive: true });
		registration = registerHoiFs();
		await whenModDependenciesSettled();
	});

	it("rejects every mutation on the read-only install-path filesystem", async function () {
		assert.ok(fsProvider, "registerHoiFs registers a provider");
		configure({ installPath: root });
		clearInstallPathCache();
		const provider = fsProvider as any;
		const uri = { scheme: "hoi4installpath", path: "/common/test.txt", toString: () => "hoi4installpath:/common/test.txt" } as vscode.Uri;
		const destination = { scheme: "hoi4installpath", path: "/common/copied.txt", toString: () => "hoi4installpath:/common/copied.txt" } as vscode.Uri;
		let delegatedWrites = 0;
		stubVscode({
			createDirectory: async () => { delegatedWrites++; },
			writeFile: async () => { delegatedWrites++; },
			delete: async () => { delegatedWrites++; },
			rename: async () => { delegatedWrites++; },
			copy: async () => { delegatedWrites++; },
		});

		for (const [operation, invoke, errorUri] of [
			["createDirectory", () => provider.createDirectory(uri), uri],
			["writeFile", () => provider.writeFile(uri, new Uint8Array(), { create: true, overwrite: true }), uri],
			["delete", () => provider.delete(uri, { recursive: true }), uri],
			["rename", () => provider.rename(uri, destination, { overwrite: true }), uri],
			["copy", () => provider.copy(uri, destination, { overwrite: true }), uri],
		] as const) {
			assert.throws(invoke, (error: any) => {
				assert.strictEqual(error.code, "NoPermissions", `${operation} error code`);
				assert.ok(error.message.includes(errorUri.toString()), `${operation} error names the rejected URI`);
				return true;
			}, `${operation} must be denied`);
		}
		assert.strictEqual(delegatedWrites, 0, "no workspace.fs mutator is called");
	});

	it("continues forwarding read operations to the configured install path", async function () {
		assert.ok(fsProvider, "registerHoiFs registers a provider");
		configure({ installPath: root });
		clearInstallPathCache();
		const provider = fsProvider as any;
		const uri = { scheme: "hoi4installpath", path: "/common/test.txt", toString: () => "hoi4installpath:/common/test.txt" } as vscode.Uri;
		const calls: string[] = [];
		const expectedFile = new Uint8Array([1, 2, 3]);
		stubVscode({
			stat: async (target: unknown) => {
				calls.push(`stat:${nodePath.normalize(realPathOf(target))}`);
				return { type: vscode.FileType.File, mtime: 1, ctime: 1, size: 3 };
			},
			readDirectory: async (target: unknown) => {
				calls.push(`readDirectory:${nodePath.normalize(realPathOf(target))}`);
				return [["test.txt", vscode.FileType.File]];
			},
			readFile: async (target: unknown) => {
				calls.push(`readFile:${nodePath.normalize(realPathOf(target))}`);
				return expectedFile;
			},
		});

		await provider.stat(uri);
		assert.deepStrictEqual(await provider.readDirectory({ scheme: "hoi4installpath", path: "/common" } as vscode.Uri), [
			["test.txt", vscode.FileType.File],
		]);
		assert.strictEqual(await provider.readFile(uri), expectedFile);
		assert.deepStrictEqual(calls, [
			`stat:${nodePath.join(root, "common", "test.txt")}`,
			`readDirectory:${nodePath.join(root, "common")}`,
			`readFile:${nodePath.join(root, "common", "test.txt")}`,
		]);
	});

	afterEach(async function () {
		registration.dispose();
		restoreVscodeStubs();
		clearInstallPathCache();
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

	it("re-reads the parent list when parentModPaths changes", async function () {
		assert.deepStrictEqual(getParentModUris(), []);

		configure({ parentModPaths: [nodePath.join(root, "parent")] });
		fireConfigurationChange("mdHoi4Utilities.parentModPaths");
		await whenModDependenciesSettled();

		assert.deepStrictEqual(
			getParentModUris().map((uri) => nodePath.resolve(realPathOf(uri))),
			[nodePath.resolve(root, "parent")],
		);
	});

	it("re-resolves the dependencies when modFile changes", async function () {
		configure({ modFile: nodePath.join(root, "sub", "descriptor.mod") });
		fireConfigurationChange("mdHoi4Utilities.modFile");
		await whenModDependenciesSettled();

		assert.deepStrictEqual(
			getParentModUris().map((uri) => nodePath.resolve(realPathOf(uri))),
			[nodePath.resolve(root, "parent")],
		);
	});

	it("drops the cached install path and checks the new one when installPath changes", async function () {
		const first = nodePath.join(root, "empty");
		const missing = nodePath.join(root, "no-such-install");
		configure({ installPath: first });
		assert.strictEqual(nodePath.resolve(realPathOf(getInstallPathUri())), nodePath.resolve(first));

		configure({ installPath: missing });
		fireConfigurationChange("mdHoi4Utilities.installPath");

		assert.strictEqual(nodePath.resolve(realPathOf(getInstallPathUri())), nodePath.resolve(missing));
		await until(() => errors.length > 0, "an install path that does not exist is reported");
		assert.ok(errors[0].includes("no-such-install"), errors[0]);
	});

	it("ignores a change to an unrelated setting", async function () {
		assert.deepStrictEqual(getParentModUris(), []);
		configure({ parentModPaths: [nodePath.join(root, "parent")] });
		fireConfigurationChange("mdHoi4Utilities.featureFlags");
		await whenModDependenciesSettled();

		assert.deepStrictEqual(getParentModUris(), []);
	});
});
