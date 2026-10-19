// Run with compiled baseline/candidate checkouts while other builds and benchmarks are idle.
const assert = require("assert");
const { fork, execFileSync } = require("child_process");
const { createHash } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");

const hash = value => createHash("sha256").update(value).digest("hex");

function child(job) {
	globalThis.IS_WEB_EXT = false;
	process.env.MD_UTILITIES_TEST = "1";
	const { getDependenciesFromText } = require(path.join(job.root, "out-test/src/util/dependency"));
	if (job.corpus) {
		const files = execFileSync("git", ["-C", job.corpus, "ls-files", "-z"], { maxBuffer: 32 * 1024 * 1024 })
			.toString().split("\0").filter(file => /\.(txt|gfx|gui|asset|mod|yml)$/i.test(file));
		const output = [];
		let bytes = 0;
		for (const file of files) {
			const input = fs.readFileSync(path.join(job.corpus, file));
			bytes += input.length;
			const dependencies = getDependenciesFromText(input.toString("utf8"));
			if (dependencies.length) { output.push([file, dependencies]); }
		}
		return { files: files.length, bytes, markerFiles: output.length, output, hash: hash(JSON.stringify(output)) };
	}
	for (let i = 0; i < 100; i++) { getDependenciesFromText("#!event:events/example.txt"); }
	const input = job.scenario.kind === "malformed"
		? "#!event:" + ":".repeat(job.scenario.length)
		: Array.from({ length: job.scenario.length }, (_, i) => `  #!event:events/folder/file${i}.txt\r\n`).join("");
	global.gc();
	const before = process.memoryUsage();
	const start = performance.now();
	const output = getDependenciesFromText(input);
	const ms = performance.now() - start;
	return { ms, inputBytes: Buffer.byteLength(input), count: output.length, hash: hash(JSON.stringify(output)),
		before, after: process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS };
}

function run(job) {
	return new Promise((resolve, reject) => {
		const proc = fork(__filename, ["--child", JSON.stringify(job)], { execArgv: ["--expose-gc"], silent: true });
		let result;
		let stderr = "";
		let timedOut = false;
		const watchdogMs = job.corpus ? 60_000 : 15_000;
		const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, watchdogMs);
		proc.stdout.resume();
		proc.stderr.on("data", chunk => { stderr += chunk; });
		proc.on("message", message => { result = message; });
		proc.on("error", error => { clearTimeout(timer); reject(error); });
		proc.on("close", (code, signal) => {
			clearTimeout(timer);
			if (timedOut) { resolve({ timedOut: true, watchdogMs }); }
			else if (code !== 0 || !result) { reject(new Error(`Child exit ${code}/${signal}: ${stderr}`)); }
			else { resolve(result); }
		});
	});
}

async function main() {
	const [baseline, candidate, output, corpus] = process.argv.slice(2);
	assert.ok(baseline && candidate && output, "Usage: node scripts/bench-dependency-markers.js BASELINE CANDIDATE OUTPUT [MOD]");
	const roots = { baseline: path.resolve(baseline), candidate: path.resolve(candidate) };
	const records = [];
	const evidence = { node: process.version, cpu: os.cpus()[0].model, repeats: 7, roots,
		revisions: Object.fromEntries(Object.entries(roots).map(([variant, root]) => [variant,
			execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()])),
		compiledHashes: Object.fromEntries(Object.entries(roots).map(([variant, root]) => [variant,
			hash(fs.readFileSync(path.join(root, "out-test/src/util/dependency.js")))])), records };
	for (const scenario of [{ kind: "malformed", length: 8000 }, { kind: "malformed", length: 32000 },
		{ kind: "malformed", length: 100000 }, { kind: "valid", length: 10000 }]) {
		let expected;
		for (let rep = 0; rep < evidence.repeats; rep++) {
			for (const variant of rep % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
				const result = await run({ root: roots[variant], scenario });
				if (!result.timedOut) {
					if (expected === undefined) { expected = result.hash; }
					assert.strictEqual(result.hash, expected, "baseline/candidate result mismatch");
				}
				records.push({ variant, rep, scenario, result });
				fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
				console.log(JSON.stringify({ variant, rep, scenario, ms: result.ms, timedOut: result.timedOut }));
			}
		}
	}
	if (corpus) {
		evidence.corpus = {};
		for (const variant of ["baseline", "candidate"]) {
			evidence.corpus[variant] = await run({ root: roots[variant], corpus: path.resolve(corpus) });
			assert.ok(!evidence.corpus[variant].timedOut, "real marker corpus watchdog expired");
		}
		fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
		assert.strictEqual(evidence.corpus.baseline.hash, evidence.corpus.candidate.hash, "real marker corpus parity changed; inspect evidence");
	}
}

if (process.argv[2] === "--child") {
	try { process.send(child(JSON.parse(process.argv[3]))); }
	catch (error) { console.error(error); process.exitCode = 1; }
	finally { process.disconnect(); }
} else { main().catch(error => { console.error(error); process.exitCode = 1; }); }
