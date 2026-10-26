import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// The package contents are decided by the .vscodeignore in the repository root, read the same way
// activation.test.ts reads the manifest.
const exclusions = fs.readFileSync(path.resolve(__dirname, "../../../../.vscodeignore"), "utf8")
	.split(/\r?\n/)
	.map((line) => line.trim());

describe(".vscodeignore exclusions", () => {
	it("excludes every agent harness directory from the package", () => {
		for (const directory of [".pi/**", ".pi-agent/**", ".pi-subagents/**"]) {
			assert.ok(exclusions.includes(directory), `.vscodeignore must exclude ${directory}`);
		}
	});
});