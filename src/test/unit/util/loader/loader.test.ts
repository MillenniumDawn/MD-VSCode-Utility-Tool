import * as assert from "assert";
import { mock } from "node:test";
import * as path from "path";
import * as fileloader from "../../../../util/fileloader";
import { FileLoader, FolderLoader, LoaderSession, LoadResult, LoadResultOD } from "../../../../util/loader/loader";

class NameLoader extends FileLoader<string> {
	protected async loadFromFile(): Promise<LoadResultOD<string>> {
		return { result: this.file };
	}
}

class NamesLoader extends FolderLoader<string[], string> {
	constructor() {
		super("common/scripts", NameLoader);
	}

	protected async mergeFiles(files: LoadResult<string>[]): Promise<LoadResult<string[]>> {
		return { result: files.map(file => file.result), dependencies: [this.folder + "/*"] };
	}
}

describe("util/loader/FolderLoader script files", () => {
	let files: string[];
	let checked: string[];

	beforeEach(() => {
		files = ["a.txt", "README.md", "backup.txt.bak", "b.TXT"];
		checked = [];
		mock.method(fileloader, "listFilesFromModOrHOI4", async () => files);
		mock.method(fileloader, "hoiFileExpiryToken", async (file: string) => {
			checked.push(file);
			return "v1";
		});
	});

	afterEach(() => mock.restoreAll());

	it("loads text scripts only, keeping their order and folder dependency", async () => {
		const result = await new NamesLoader().load(new LoaderSession(false));

		assert.deepStrictEqual(result.result, ["a.txt", "b.TXT"].map(file => path.join("common/scripts", file)));
		assert.deepStrictEqual(checked, result.result);
		assert.deepStrictEqual(result.dependencies, ["common/scripts/*"]);
	});

	it("ignores documentation changes but reloads when a script is added or removed", async () => {
		const loader = new NamesLoader();
		await loader.load(new LoaderSession(false));
		files = ["a.txt", "another.md", "b.TXT", "a.txt~"];
		assert.strictEqual(await loader.shouldReload(new LoaderSession(false)), false);

		files.push("c.txt");
		assert.strictEqual(await loader.shouldReload(new LoaderSession(false)), true);
		const loaded = await loader.load(new LoaderSession(false));
		assert.deepStrictEqual(loaded.result, ["a.txt", "b.TXT", "c.txt"].map(file => path.join("common/scripts", file)));

		files = ["a.txt", "README.md", "c.txt"];
		assert.strictEqual(await loader.shouldReload(new LoaderSession(false)), true);
		assert.deepStrictEqual((await loader.load(new LoaderSession(false))).result, ["a.txt", "c.txt"].map(file => path.join("common/scripts", file)));
		assert.ok(checked.every(file => file.toLowerCase().endsWith(".txt")));
	});
});
