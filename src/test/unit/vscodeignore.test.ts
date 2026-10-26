import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// The package contents are decided by the .vscodeignore in the repository root, read the same way
// activation.test.ts reads the manifest.
const repositoryRoot = path.resolve(__dirname, "..", "..", "..", "..");
const exclusions = fs.readFileSync(path.join(repositoryRoot, ".vscodeignore"), "utf8")
	.split(/\r?\n/)
	.map((line) => line.trim());

// The pinned @vscode/vsce listFiles is the same file walk the VSIX build runs, .vscodeignore
// included, so it can prove the exclusion rather than restate it.
const vsce = require("@vscode/vsce") as typeof import("@vscode/vsce");

describe(".vscodeignore exclusions", () => {
	it("excludes every agent harness directory from the package", () => {
		for (const directory of [".pi/**", ".pi-agent/**", ".pi-subagents/**"]) {
			assert.ok(exclusions.includes(directory), `.vscodeignore must exclude ${directory}`);
		}
	});

	it("keeps nested agent scratch out of the real packaging candidates", async function () {
		// Scratch is written under the already-ignored .pi tree and left there, so the VSIX the
		// packaging job later archives can be inspected against these paths.
		const scratch = path.join(repositoryRoot, ".pi", "subagents", "packaging-regression");
		fs.mkdirSync(path.join(scratch, "nested"), { recursive: true });
		fs.writeFileSync(path.join(scratch, "harness-scratch.txt"), "issue #644 packaging fixture\n");
		fs.writeFileSync(path.join(scratch, "nested", "agent-note.md"), "nested agent scratch\n");

		this.timeout(30000);
		const files = await vsce.listFiles({ cwd: repositoryRoot, packageManager: vsce.PackageManager.None });
		const candidates = files.map((file) => file.replace(/\\/g, "/"));

		assert.ok(candidates.includes("package.json"), "package.json must stay a packaging candidate");
		assert.ok(candidates.includes("README.md"), "README.md must stay a packaging candidate");
		assert.strictEqual(
			candidates.filter((file) => file.startsWith(".pi/")).join(", "),
			"",
			"no .pi path may be a packaging candidate",
		);
	});
});
