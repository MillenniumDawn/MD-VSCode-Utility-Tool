import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

interface Step {
	uses?: string;
	run?: string;
	with?: Record<string, unknown>;
	env?: Record<string, string>;
}

interface Workflow {
	jobs: Record<string, { steps?: Step[] }>;
}

const workflowDir = path.join(__dirname, "..", "..", "..", "..", ".github", "workflows");

function steps(file: string): Step[] {
	const workflow = yaml.load(fs.readFileSync(path.join(workflowDir, file), "utf8")) as Workflow;
	return Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
}

describe("workflow checkout and comment safety", () => {
	it("never persists checkout credentials in any workflow", () => {
		for (const file of fs.readdirSync(workflowDir).filter(file => /\.ya?ml$/.test(file))) {
			for (const step of steps(file)) {
				if (step.uses?.startsWith("actions/checkout@")) {
					assert.strictEqual(step.with?.["persist-credentials"], false, file);
				}
			}
		}
	});

	it("passes the pull request base ref as data, not shell source", () => {
		const check = steps("version-check.yml").find(step => step.run?.includes("scripts/check-version.js"));
		assert.ok(check);
		assert.strictEqual(check.env?.BASE_REF, "${{ github.base_ref }}");
		assert.match(check.run ?? "", /--base-ref "origin\/\$BASE_REF"/);
		assert.doesNotMatch(check.run ?? "", /\$\{\{/);
	});

	it("searches every page for an existing version-check comment", () => {
		const comment = steps("version-check.yml").find(step => step.run?.includes("<!-- version-check -->"));
		assert.ok(comment);
		assert.match(comment.run ?? "", /comments="repos\/\$GITHUB_REPOSITORY\/issues\/\$PR\/comments"/);
		assert.match(comment.run ?? "", /gh api "\$comments" --paginate\b/);
	});
});
