import * as assert from "assert";
import * as vscode from "vscode";
import { contextContainer } from "../context";
import {
	captureCacheScope,
	ensureCacheDir,
	loadCacheData,
	saveCacheData,
} from "../util/indexCache";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

describe("util/indexCache cache scopes", function () {
	let originalContext: vscode.ExtensionContext | null;
	let configuration: { modFile?: string; parentModPaths?: string[] };
	let cacheStore: Map<string, Uint8Array>;

	beforeEach(function () {
		originalContext = contextContainer.current;
		contextContainer.current = {
			globalStorageUri: vscode.Uri.file("storage"),
		} as unknown as vscode.ExtensionContext;
		configuration = { parentModPaths: ["/parent-one"] };
		cacheStore = new Map();
		stubVscode({
			getConfiguration: () => configuration,
			workspaceFolders: [
				{ uri: vscode.Uri.file("workspace") } as vscode.WorkspaceFolder,
			],
			writeFile: async (uri, content) => {
				cacheStore.set(uri.path, content);
			},
			readFile: async (uri) => {
				const content = cacheStore.get(uri.path);
				if (!content) {
					throw new Error(`no such cache file: ${uri.path}`);
				}
				return content;
			},
		});
	});

	afterEach(function () {
		contextContainer.current = originalContext;
		restoreVscodeStubs();
	});

	it("keeps a captured namespace across a configuration change", async function () {
		const oldScope = captureCacheScope();
		if (!oldScope) {
			throw new Error("cache scope was not captured");
		}

		configuration.parentModPaths = ["/parent-two"];
		const newScope = captureCacheScope();
		if (!newScope) {
			throw new Error("cache scope was not captured");
		}
		assert.notStrictEqual(oldScope.path, newScope.path);

		await ensureCacheDir(oldScope);
		await saveCacheData("scope", "old", oldScope);
		await saveCacheData("scope", "new", newScope);

		assert.strictEqual(await loadCacheData("scope", oldScope), "old");
		assert.strictEqual(await loadCacheData("scope", newScope), "new");
		assert.strictEqual(await loadCacheData("scope"), "new");
	});
});
