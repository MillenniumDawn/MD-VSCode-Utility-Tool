import * as assert from "assert";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDependenciesFromText } from "../../../util/dependency";

describe("util/dependency marker parsing", () => {
	it("scans a long malformed marker under a parent watchdog", async function () {
		this.timeout(5000);
		const { stdout } = await promisify(execFile)(process.execPath, ["-e", `
			globalThis.IS_WEB_EXT = false;
			process.env.MD_UTILITIES_TEST = '1';
			const { getDependenciesFromText } = require(process.argv[1]);
			process.stdout.write(JSON.stringify(getDependenciesFromText('#!event:' + ':'.repeat(100000))));
		`, require.resolve("../../../util/dependency")], { timeout: 2000, killSignal: "SIGKILL" });
		assert.strictEqual(stdout, "[]");
	});

	for (const padding of ["  ", "\t", " \t "]) {
		it(`trims path whitespace before checking extensions: ${JSON.stringify(padding)}`, () => {
			assert.deepStrictEqual(getDependenciesFromText(`#!event:  events/foo.txt${padding}\r\n`),
				[{ type: "event", path: "events/foo.txt" }]);
		});
	}

	it("preserves path colons, final extensions, slash normalization and declaration order", () => {
		assert.deepStrictEqual(getDependenciesFromText([
			"  #!event:events/has:colon.part.txt",
			"#!gfx:interface\\\\icons.gfx",
			"#!localisation:localisation//english.yml",
			"#!event:events/two.txt",
		].join("\r\n")), [
			{ type: "event", path: "events/has:colon.part.txt" },
			{ type: "gfx", path: "interface/icons.gfx" },
			{ type: "localisation", path: "localisation/english.yml" },
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
