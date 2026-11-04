import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface Step {
	run?: string;
	if?: string;
}

interface Workflow {
	jobs: Record<string, { steps?: Step[] }>;
}

const repoRoot = path.join(__dirname, "..", "..", "..", "..", "..");
const workflow = yaml.load(
	fs.readFileSync(path.join(repoRoot, ".github", "workflows", "test.yml"), "utf8"),
) as Workflow;
const scripts = (JSON.parse(
	fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as { scripts: Record<string, string> }).scripts;
const compileScript = fs.readFileSync(path.join(repoRoot, "scripts", "compile-tests.js"), "utf8");

describe("the Windows-only unit job keeps Ubuntu coverage", () => {
	it("runs the coverage command over the same suite the removed Ubuntu runner executed", () => {
		// The standalone Ubuntu member went out of the unit matrix; the only Linux execution of the
		// suite left in .github/workflows/test.yml is the coverage step of the test job, so it has to
		// be the same `npm test` under c8, not a narrower command.
		assert.strictEqual(scripts["test:coverage"], "c8 npm test --ignore-scripts");
		assert.strictEqual(scripts["pretest:coverage"], scripts.pretest);
		assert.strictEqual(scripts.pretest, "node scripts/compile-tests.js");
	});

	it("coverage compiles the same two test projects as the plain suite", () => {
		assert.match(
			compileScript,
			/\["tsconfig\.test\.json", "tsconfig\.webview\.test\.json"\]/,
		);
	});

	it("keeps the pure, legacy and webview collections in the covered command", () => {
		const test = scripts.test;
		assert.ok(test.includes("out-test/src/test/unit/setup.js"), "no unit setup require");
		assert.ok(
			test.includes("out-test/src/test/unit/**/*.test.js"),
			"the pure collection is missing from the coverage run",
		);
		assert.ok(
			test.includes("./out-test/src/test/_vscode_stub.js"),
			"the legacy stub collection is missing from the coverage run",
		);
		assert.ok(
			test.includes("out-test-webview/src/test/webview/**/*.test.js"),
			"the jsdom webview collection is missing from the coverage run",
		);
	});

	it("keeps the gates and packaging steps running on Ubuntu", () => {
		const runs = (workflow.jobs.test?.steps ?? []).map(step => step.run ?? "");
		for (const command of [
			"npm run lint",
			"node scripts/native-tsc.js --noEmit -p tsconfig.json",
			"npm run knip",
			"npm run dupes",
			"npm run test:coverage",
			"npm run package",
			"npm run smoke:webviews",
			"npm run test:integration",
			"npm run test:web",
		]) {
			assert.ok(runs.some(run => run.includes(command)), `${command} is not in the test job`);
		}
		const gate = (workflow.jobs.test?.steps ?? []).find(step =>
			step.run?.includes("scripts/diff-coverage.js"));
		assert.ok(gate, "the changed-lines coverage gate is not in the test job");
		assert.strictEqual(gate.if, "github.event_name == 'pull_request'");
	});
});