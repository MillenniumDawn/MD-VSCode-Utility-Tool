import * as assert from "assert";
import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import { getDependenciesFromText } from "../../../util/dependency";

// Scans `head + fill.repeat(count) + tail` in a child that is killed after 2 s, so a scan that
// goes quadratic fails the test instead of hanging the run. The text is built in the child
// because an argument that long does not fit on a command line.
async function scanInChild(head: string, fill: string, count: number, tail: string): Promise<unknown> {
	// Without the coverage collector: it would slow the child down and is not under test.
	const { NODE_V8_COVERAGE: _coverage, ...env } = process.env;
	const { stdout } = await promisify(execFile)(process.execPath, [
		"--require", path.join(__dirname, "..", "setup.js"),
		"-e", `
			const { getDependenciesFromText } = require(process.argv[1]);
			const { head, fill, count, tail } = JSON.parse(process.argv[2]);
			process.stdout.write(JSON.stringify(getDependenciesFromText(head + fill.repeat(count) + tail)));
		`,
		require.resolve("../../../util/dependency"),
		JSON.stringify({ head, fill, count, tail }),
	], { env, timeout: 2000, killSignal: "SIGKILL" });
	return JSON.parse(stdout);
}

describe("util/dependency marker parsing", () => {
	it("returns an empty list for text with no dependency markers", () => {
		assert.deepStrictEqual(getDependenciesFromText(""), []);
		assert.deepStrictEqual(getDependenciesFromText("name = 1\nother = 2\n"), []);
	});

	it("parses a single dependency marker", () => {
		assert.deepStrictEqual(getDependenciesFromText("#!event:events/foo.txt\n"), [
			{ type: "event", path: "events/foo.txt" },
		]);
	});

	it("parses txt and yml markers, and includes type===ext markers", () => {
		// The filter is `type === ext || ext === 'txt' || ext === 'yml'`.
		// For a marker like `#!sprite:gfx/sprite.gfx`, type=`sprite` and ext=`gfx`,
		// so it is filtered out. The only way a type can match its extension is
		// when the extension literally equals the type (e.g. `#!sprite:foo.sprite`).
		const text = [
			"#!event:events/foo.txt",
			"#!localisation:localisation/replace/english.yml",
			"#!sprite:data/foo.sprite",
			"#!sprite:gfx/sprite.gfx",
			"#!other:foo.bar",
		].join("\n") + "\n";

		assert.deepStrictEqual(getDependenciesFromText(text), [
			{ type: "event", path: "events/foo.txt" },
			{ type: "localisation", path: "localisation/replace/english.yml" },
			{ type: "sprite", path: "data/foo.sprite" },
		]);
	});

	it("ignores lines where the extension is unsupported", () => {
		const text = [
			"#!event:events/foo.png",
			"#!note:docs/readme.md",
			"#!event:events/bar.txt",
		].join("\n") + "\n";

		assert.deepStrictEqual(getDependenciesFromText(text), [{ type: "event", path: "events/bar.txt" }]);
	});

	it("accepts leading whitespace before the marker", () => {
		assert.deepStrictEqual(getDependenciesFromText("   #!event:events/foo.txt\n"), [
			{ type: "event", path: "events/foo.txt" },
		]);
	});

	it("does not match markers that are not at the start of a line", () => {
		assert.deepStrictEqual(getDependenciesFromText("desc = \"#!event:events/foo.txt\"\n"), []);
	});

	it("preserves multiple dependencies in declaration order", () => {
		const text = [
			"#!event:events/a.txt",
			"#!event:events/b.txt",
			"#!localisation:localisation/a.yml",
			"#!event:events/c.txt",
		].join("\n") + "\n";

		assert.deepStrictEqual(getDependenciesFromText(text), [
			{ type: "event", path: "events/a.txt" },
			{ type: "event", path: "events/b.txt" },
			{ type: "localisation", path: "localisation/a.yml" },
			{ type: "event", path: "events/c.txt" },
		]);
	});

	it("normalizes multiple slashes and backslashes in the path to a single forward slash", () => {
		const text = [
			"#!event:events\\\\sub\\\\foo.txt",
			"#!event:events//sub//bar.txt",
		].join("\n") + "\n";

		assert.deepStrictEqual(getDependenciesFromText(text), [
			{ type: "event", path: "events/sub/foo.txt" },
			{ type: "event", path: "events/sub/bar.txt" },
		]);
	});

	it("trims leading and trailing whitespace around the path", () => {
		assert.deepStrictEqual(getDependenciesFromText("#!event:  events/foo.txt  \n"), [
			{ type: "event", path: "events/foo.txt" },
		]);
	});

	it("ignores comment-like text that is not a marker", () => {
		assert.deepStrictEqual(getDependenciesFromText(
			"# this is a regular comment\n#!event:events/foo.txt\n"), [
			{ type: "event", path: "events/foo.txt" },
		]);
	});

	it("scans a very long malformed marker line in linear time", async function () {
		this.timeout(5000);
		assert.deepStrictEqual(await scanInChild("#!event:", ":", 300000, "\n#!event:events/a.txt"),
			[{ type: "event", path: "events/a.txt" }]);
	});

	it("scans a very long run of blank CRLF lines in linear time", async function () {
		this.timeout(5000);
		assert.deepStrictEqual(await scanInChild("", "\r\n", 200000, "x\n#!event:events/b.txt"),
			[{ type: "event", path: "events/b.txt" }]);
	});

	for (const padding of ["  ", "\t", " \t "]) {
		it(`trims path whitespace before checking extensions: ${JSON.stringify(padding)}`, () => {
			assert.deepStrictEqual(getDependenciesFromText(`#!event:events/foo.txt${padding}\r\n`),
				[{ type: "event", path: "events/foo.txt" }]);
		});
	}

	it("reads CRLF lines, keeping colons in the path and the extension after the last dot", () => {
		assert.deepStrictEqual(getDependenciesFromText([
			"  #!event:events/has:colon.part.txt",
			"#!event:events/two.txt",
		].join("\r\n")), [
			{ type: "event", path: "events/has:colon.part.txt" },
			{ type: "event", path: "events/two.txt" },
		]);
	});

	it("keeps extension and type case sensitivity and rejects incomplete markers", () => {
		assert.deepStrictEqual(getDependenciesFromText([
			"#!event:events/foo.TXT", "#!:foo.txt", "#!event:foo", "#!event:foo.",
			"#!event\n:foo.txt", "name = #!event:events/foo.txt", "#!GFX:interface/foo.gfx",
		].join("\n")), []);
	});

	for (const separator of ["\u2028", "\u2029"]) {
		it(`preserves marker boundaries at ${JSON.stringify(separator)}`, () => {
			assert.deepStrictEqual(getDependenciesFromText(`#!event:events/a.txt${separator}#!event:events/b.txt`), [
				{ type: "event", path: "events/a.txt" },
				{ type: "event", path: "events/b.txt" },
			]);
			assert.deepStrictEqual(getDependenciesFromText(`#!event${separator}:events/a.txt`), []);
		});
	}
});
