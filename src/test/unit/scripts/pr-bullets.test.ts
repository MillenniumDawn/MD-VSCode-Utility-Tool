import * as assert from "assert";

const childProcess = require("child_process");
const { bulletsFromPullRequests } = require("../../../../../scripts/pr-bullets");
const { select } = require("../../../../../scripts/select-bullets");
const releasePrBody = require("../../../../../scripts/release-pr-body");

function collectWithApiResponses(canonicalResponse: unknown, embeddedLabels: unknown[]) {
	const repo = "MillenniumDawn/MD-VSCode-Utility-Tool";
	const gitPath = require.resolve("../../../../../scripts/lib/git");
	const githubPath = require.resolve("../../../../../scripts/lib/github");
	const bulletsPath = require.resolve("../../../../../scripts/pr-bullets");
	const cachedModules = [gitPath, githubPath, bulletsPath].map((path) => require.cache[path]);
	const originalExecFileSync = childProcess.execFileSync;

	delete require.cache[gitPath];
	delete require.cache[githubPath];
	delete require.cache[bulletsPath];
	(childProcess as unknown as { execFileSync: typeof childProcess.execFileSync }).execFileSync = ((file: string, args: string[]) => {
		if (file === "git") {
			return "abc\n";
		}
		assert.strictEqual(file, "gh");
		const apiPath = args[1];
		if (apiPath === `repos/${repo}/commits/abc/pulls`) {
			return JSON.stringify([{
				number: 533,
				title: "Internal release pipeline change",
				body: "",
				labels: embeddedLabels,
				user: { login: "contributor" },
			}]);
		}
		if (apiPath === `repos/${repo}/pulls/533`) {
			if (canonicalResponse instanceof Error) {
				throw canonicalResponse;
			}
			return JSON.stringify(canonicalResponse);
		}
		if (apiPath === `repos/${repo}/pulls/533/files`) {
			return JSON.stringify([{ filename: "scripts/pr-bullets.js" }]);
		}
		throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
	}) as typeof childProcess.execFileSync;

	try {
		return require(bulletsPath).collect({ tag: "v1.0.0", repo });
	} finally {
		(childProcess as unknown as { execFileSync: typeof childProcess.execFileSync }).execFileSync = originalExecFileSync;
		[gitPath, githubPath, bulletsPath].forEach((path, index) => {
			delete require.cache[path];
			if (cachedModules[index]) {
				require.cache[path] = cachedModules[index];
			}
		});
	}
}

describe("scripts/pr-bullets", () => {
	it("omits no-changelog bullets while retaining the pull request in release coverage", () => {
		const collected = bulletsFromPullRequests([
			{ number: 533, title: "Internal release pipeline change", labels: [{ name: "no-changelog" }], files: ["scripts/pr-bullets.js"] },
			{ number: 534, title: "Improve the focus tree preview", labels: ["enhancement"], files: ["src/previewdef/focustree/preview.ts"] },
			{ number: 535, title: "Dependency update", user: { login: "dependabot[bot]" } },
			{ number: 536, title: "Document the release", files: ["CHANGELOG.md"] },
		]);

		assert.deepStrictEqual(collected.pullRequests, [533, 534, 536]);
		assert.deepStrictEqual(collected.bullets, ["", "- [ Focus Tree ] Improve the focus tree preview.", "- Document the release."]);
		assert.strictEqual(collected.entries[0].noChangelog, true);
		assert.strictEqual(collected.entries[1].noChangelog, undefined);
		assert.strictEqual(collected.entries[2].wroteChangelog, true);

		const selected = select(collected, {});
		assert.deepStrictEqual(selected.pullRequests, [534]);
		assert.deepStrictEqual(selected.bullets, ["- [ Focus Tree ] Improve the focus tree preview."]);
	});

	it("uses canonical labels and falls back to embedded labels when the canonical response is unavailable", () => {
		const canonicalOptOut = collectWithApiResponses(
			{ labels: [{ name: "NO-CHANGELOG" }, { name: "bug" }] },
			[{ name: "bug" }],
		);
		assert.strictEqual(canonicalOptOut.entries[0].noChangelog, true);
		assert.strictEqual(canonicalOptOut.entries[0].section, "Bugfixes");
		assert.deepStrictEqual(canonicalOptOut.pullRequests, [533]);
		assert.deepStrictEqual(select(canonicalOptOut, {}).bullets, []);
		const body = releasePrBody.render({ version: "1.0.1", entries: canonicalOptOut.entries });
		assert.ok(body.includes("- #533 Internal release pipeline change"));
		assert.ok(body.includes("Included pull requests: 533"));

		const embeddedFallback = collectWithApiResponses(
			new Error("synthetic API failure"),
			[{ name: "bug" }, { name: "no-changelog" }],
		);
		assert.strictEqual(embeddedFallback.entries[0].noChangelog, true);
		assert.strictEqual(embeddedFallback.entries[0].section, "Bugfixes");

		const missingCanonicalLabels = collectWithApiResponses({}, [{ name: "bug" }]);
		assert.strictEqual(missingCanonicalLabels.entries[0].noChangelog, undefined);
		assert.strictEqual(missingCanonicalLabels.entries[0].section, "Bugfixes");

		const emptyCanonicalLabels = collectWithApiResponses(
			{ labels: [] },
			[{ name: "no-changelog" }],
		);
		assert.strictEqual(emptyCanonicalLabels.entries[0].noChangelog, undefined);
	});

	it("keeps an opted-out pull request in the release body list and coverage trailer", () => {
		const collected = bulletsFromPullRequests([
			{ number: 533, title: "Internal release pipeline change", labels: ["no-changelog"] },
		]);
		const body = releasePrBody.render({ version: "1.0.1", entries: collected.entries });
		assert.ok(body.includes("- #533 Internal release pipeline change"));
		assert.ok(body.includes("Included pull requests: 533"));
	});
});
