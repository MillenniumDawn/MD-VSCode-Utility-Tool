import * as assert from "assert";
import { mock } from "node:test";
import * as path from "path";
import { walkFiles } from "./files";

const fs = require("fs") as typeof import("fs");
const root = path.resolve("walk-fixture");

describe("test file walks", () => {
	afterEach(() => mock.restoreAll());

	function directory(entries: Record<string, [string, boolean][]>): string[] {
		const read: string[] = [];
		mock.method(fs, "readdirSync", (dir: string, options: unknown) => {
			assert.deepStrictEqual(options, { withFileTypes: true });
			read.push(dir);
			assert.ok(entries[dir], `unexpected directory: ${dir}`);
			return entries[dir].map(([name, isDirectory]) => ({ name, isDirectory: () => isDirectory }));
		});
		return read;
	}

	it("keeps directory order and visits a subtree before the next sibling", () => {
		directory({
			[root]: [["first.ts", false], ["sub", true], ["last.ts", false]],
			[path.join(root, "sub")]: [["nested.ts", false]],
		});
		assert.deepStrictEqual(walkFiles(root, () => true), [
			path.join(root, "first.ts"), path.join(root, "sub", "nested.ts"), path.join(root, "last.ts"),
		]);
	});

	it("passes full paths to the file filter and never enters an excluded directory", () => {
		const read = directory({
			[root]: [["keep.ts", false], ["types.d.ts", false], ["test", true], ["sub", true]],
			[path.join(root, "sub")]: [["skip.html", false], ["nested.ts", false]],
		});
		const seen: string[] = [];
		const files = walkFiles(root, file => {
			seen.push(file);
			return file.endsWith(".ts") && !file.endsWith(".d.ts");
		}, [path.join(root, "test")]);
		assert.deepStrictEqual(files, [path.join(root, "keep.ts"), path.join(root, "sub", "nested.ts")]);
		assert.deepStrictEqual(read, [root, path.join(root, "sub")]);
		assert.deepStrictEqual(seen, ["keep.ts", "types.d.ts", "sub/skip.html", "sub/nested.ts"].map(file => path.join(root, file)));
	});

	it("preserves a directory read failure instead of returning a partial list", () => {
		const failure = new Error("cannot list");
		mock.method(fs, "readdirSync", (dir: string) => {
			if (dir === root) {
				return [{ name: "sub", isDirectory: () => true }];
			}
			throw failure;
		});
		assert.throws(() => walkFiles(root, () => true), error => error === failure);
	});
});
