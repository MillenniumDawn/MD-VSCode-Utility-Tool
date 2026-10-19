// Compare the focused hover tooltip test suite before and after a test-only change.
// Run after compiling tests in both checkouts:
//   node scripts/bench-hover-test.js <baseline-checkout> <candidate-checkout> <output.json>

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { performance } = require("perf_hooks");

const repeats = 7;

function runMocha(root, preload, rssFile) {
	return new Promise((resolve, reject) => {
		execFile(process.execPath, [
			"--require", preload,
			path.join(root, "node_modules/mocha/bin/mocha.js"),
			"--forbid-only",
			"--reporter", "json",
			"--require", "./out-test/src/test/_vscode_stub.js",
			"out-test-webview/src/test/webview/hovertooltip.test.js",
		], {
			cwd: root,
			env: { ...process.env, MD_HOVER_BENCH_RSS: rssFile },
			timeout: 15000,
			killSignal: "SIGKILL",
		}, (error, stdout) => {
			if (error) {
				reject(error);
			} else {
				resolve(stdout);
			}
		});
	});
}

async function main() {
	const [baselineArg, candidateArg, outputArg] = process.argv.slice(2);
	if (!baselineArg || !candidateArg || !outputArg) {
		throw new Error("Usage: node scripts/bench-hover-test.js <baseline> <candidate> <output.json>");
	}
	const roots = {
		baseline: path.resolve(baselineArg),
		candidate: path.resolve(candidateArg),
	};
	const output = path.resolve(outputArg);
	const evidence = {
		node: process.version,
		cpu: os.cpus()[0].model,
		repeats,
		revisions: Object.fromEntries(Object.entries(roots).map(([variant, root]) => [
			variant,
			execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		])),
		records: [],
	};
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "md-hover-bench-"));
	const preload = path.join(temp, "memory.js");
	fs.writeFileSync(preload, 'process.on("exit", () => require("fs").writeFileSync(process.env.MD_HOVER_BENCH_RSS, String(process.resourceUsage().maxRSS)));');
	fs.mkdirSync(path.dirname(output), { recursive: true });
	try {
		for (let rep = 0; rep < repeats; rep++) {
			const order = rep % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
			for (const variant of order) {
				const root = roots[variant];
				const rssFile = path.join(temp, "max-rss");
				const start = performance.now();
				const stdout = await runMocha(root, preload, rssFile);
				const wallMs = performance.now() - start;
				const { stats } = JSON.parse(stdout);
				assert.strictEqual(stats.failures, 0, `${variant} run ${rep} had failures`);
				assert.strictEqual(stats.passes, 7, `${variant} run ${rep} did not run all seven tests`);
				evidence.records.push({
					variant,
					rep,
					wallMs,
					suiteMs: stats.duration,
					maxRssKiB: Number(fs.readFileSync(rssFile, "utf8").trim()),
					passes: stats.passes,
				});
				fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
			}
		}
	} finally {
		fs.rmSync(temp, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
