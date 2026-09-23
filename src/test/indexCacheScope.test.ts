import * as assert from "assert";
import * as vscode from "vscode";
import { contextContainer } from "../context";
import {
	captureCacheScope,
	ensureCacheDir,
	loadCacheRecords,
	saveCacheRecords,
} from "../util/indexCache";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";
import { clearParentModCache } from "../util/parentmods";

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
		clearParentModCache();
		const newScope = captureCacheScope();
		if (!newScope) {
			throw new Error("cache scope was not captured");
		}
		assert.notStrictEqual(oldScope.path, newScope.path);

		await ensureCacheDir(oldScope);
		await saveCacheRecords("scope", [["old"]], oldScope);
		await saveCacheRecords("scope", [["new"]], newScope);

		assert.deepStrictEqual(await loadCacheRecords("scope", oldScope), [["old"]]);
		assert.deepStrictEqual(await loadCacheRecords("scope", newScope), [["new"]]);
		assert.deepStrictEqual(await loadCacheRecords("scope"), [["new"]]);
	});
});

describe("util/indexCache cache records", function () {
	let originalContext: vscode.ExtensionContext | null;
	let cacheStore: Map<string, Uint8Array>;

	beforeEach(function () {
		originalContext = contextContainer.current;
		contextContainer.current = {
			globalStorageUri: vscode.Uri.file("storage"),
		} as unknown as vscode.ExtensionContext;
		cacheStore = new Map();
		stubVscode({
			getConfiguration: () => ({}),
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

	function storedText(indexName: string): string {
		const path = [...cacheStore.keys()].find((key) =>
			key.endsWith(`${indexName}.data.jsonl`),
		);
		assert.ok(path, `${indexName} was never written`);
		return Buffer.from(cacheStore.get(path)!).toString();
	}

	function store(indexName: string, text: string): void {
		const scope = captureCacheScope();
		if (!scope) {
			throw new Error("cache scope was not captured");
		}
		cacheStore.set(
			vscode.Uri.joinPath(scope, `${indexName}.data.jsonl`).path,
			Buffer.from(text),
		);
	}

	it("writes one line per record and the count last", async function () {
		await saveCacheRecords("lines", [["a", ["x"]], ["b", []]]);

		assert.strictEqual(storedText("lines"), '["a",["x"]]\n["b",[]]\n2\n');
	});

	it("round-trips text with newlines, quotes and non-ASCII characters", async function () {
		const records = [
			["l_english", "a.yml", { KEY: 'line one\nline "two"' }],
			["l_russian", "b.yml", { KEY: "Здравствуйте §Y€§!" }],
		];
		await saveCacheRecords("text", records);

		assert.deepStrictEqual(await loadCacheRecords("text"), records);
	});

	it("round-trips an empty cache", async function () {
		await saveCacheRecords("empty", []);

		assert.deepStrictEqual(await loadCacheRecords("empty"), []);
	});

	it("returns null when there is no data file", async function () {
		assert.strictEqual(await loadCacheRecords("missing"), null);
	});

	it("rejects a file cut short at a line boundary", async function () {
		store("truncated", '["a",["x"]]\n["b",[]]\n');

		await assert.rejects(loadCacheRecords("truncated"));
	});

	it("rejects a count that does not match the records", async function () {
		store("miscounted", '["a",["x"]]\n3\n');

		await assert.rejects(loadCacheRecords("miscounted"));
	});

	it("rejects a line that is not JSON", async function () {
		store("corrupt", '["a",["x"]]\n{ this is not json\n2\n');

		await assert.rejects(loadCacheRecords("corrupt"));
	});
});
