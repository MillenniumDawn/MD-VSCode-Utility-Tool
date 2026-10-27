import * as assert from "assert";
import { spawnSync } from "child_process";
import * as path from "path";

describe("every source module", () => {
	it("loads with no editor, apart from the entry point", () => {
		// Without the coverage collector: loading a file is not a test of what is in it.
		const { NODE_V8_COVERAGE: _coverage, ...env } = process.env;
		const run = spawnSync(
			process.execPath,
			["--require", path.join(__dirname, "setup.js"), path.join(__dirname, "loadall.js")],
			{ encoding: "utf8", env },
		);
		assert.strictEqual(run.status, 0, run.stderr);

		assert.deepStrictEqual(JSON.parse(run.stdout), {
			// The one file that imports the editor's API, to hand it over.
			"extension.js": "Cannot find module 'vscode'",
		});
	});
});
