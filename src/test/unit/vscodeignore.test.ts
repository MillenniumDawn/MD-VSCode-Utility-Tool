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
		for (const directory of [".pi/**", ".pi-subagents/**"]) {
			assert.ok(exclusions.includes(directory), `.vscodeignore must exclude ${directory}`);
		}
	});

	it("keeps agent scratch and .tmp scratch out of the real packaging candidates", async function () {
		const agentScratch = path.join(repositoryRoot, ".pi", "subagents", "packaging-regression");
		const tmpScratch = path.join(repositoryRoot, ".tmp", "vscodeignore-regression");
		// The first folder each scratch creates, so a checkout without either is left without it.
		const createdAgentRoot = fs.mkdirSync(path.join(agentScratch, "nested"), { recursive: true });
		const createdTmpRoot = fs.mkdirSync(tmpScratch, { recursive: true });
		let files: string[];
		try {
			fs.writeFileSync(path.join(agentScratch, "harness-scratch.txt"), "issue #644 packaging fixture\n");
			fs.writeFileSync(path.join(agentScratch, "nested", "agent-note.md"), "nested agent scratch\n");
			fs.writeFileSync(path.join(tmpScratch, "scratch-edge-bench.js"), "issue #680 packaging fixture\n");

			this.timeout(30000);
			files = await vsce.listFiles({ cwd: repositoryRoot, packageManager: vsce.PackageManager.None });
		} finally {
			fs.rmSync(createdAgentRoot ?? agentScratch, { recursive: true, force: true });
			fs.rmSync(createdTmpRoot ?? tmpScratch, { recursive: true, force: true });
		}
		const candidates = files.map((file) => file.replace(/\\/g, "/"));

		assert.ok(candidates.includes("package.json"), "package.json must stay a packaging candidate");
		assert.ok(candidates.includes("README.md"), "README.md must stay a packaging candidate");
		assert.strictEqual(
			candidates.filter((file) => file.startsWith(".pi/")).join(", "),
			"",
			"no .pi path may be a packaging candidate",
		);
		assert.strictEqual(
			candidates.filter((file) => file.startsWith(".tmp/")).join(", "),
			"",
			"no .tmp path may be a packaging candidate",
		);
	});
});
