// Headless, paired subprocess measurements. See scripts/bench-parser-image.md for commands/limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fork, execFileSync } = require("child_process");
const { createHash } = require("crypto");
const { performance } = require("perf_hooks");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const memory = () => process.memoryUsage();
const sourcePath = (root, relative) => path.join(root, "out-test/src", relative);

async function child(job) {
	globalThis.IS_WEB_EXT = false;
	process.env.MD_UTILITIES_TEST = "1";
	const parser = require(sourcePath(job.root, "hoiformat/hoiparser.js"));
	if (job.suite === "parser") {
		parser.parseHoi4File("a = 1");
		const before = memory();
		const start = performance.now();
		let failure;
		try {
			parser.parseHoi4File('a = "' + "\\".repeat(job.pairs * 2));
		} catch (e) {
			failure = e.name;
		}
		return { ms: performance.now() - start, failure, before, after: memory() };
	}
	if (job.suite === "corpus") {
		const files = execFileSync("git", ["-C", job.mod, "ls-files", "-z"], { maxBuffer: 32 * 1024 * 1024 })
			.toString().split("\0").filter((f) => /\.(txt|gui|gfx|asset|mod)$/i.test(f)).sort();
		const results = [];
		const inputHash = createHash("sha256");
		let parseMs = 0;
		let bytes = 0;
		for (const file of files) {
			process.send({ progress: file });
			const input = fs.readFileSync(path.join(job.mod, file));
			inputHash.update(file).update("\0").update(input);
			bytes += input.length;
			let result;
			const start = performance.now();
			try {
				result = parser.parseHoi4File(input.toString("utf8"), file + ": ");
			} catch (e) {
				result = { error: e.name, message: e.message };
			}
			parseMs += performance.now() - start;
			results.push({ file, digest: hash(JSON.stringify(result)), error: result.error });
		}
		fs.writeFileSync(job.manifest, JSON.stringify(results));
		return { files: files.length, bytes, parseMs, inputHash: inputHash.digest("hex"),
			digest: hash(JSON.stringify(results)), failures: results.filter((r) => r.error),
			maxRssKiB: process.resourceUsage().maxRSS, after: memory() };
	}

	const decoder = require(sourcePath(job.root, "util/image/imagedecoder.js"));
	require(sourcePath(job.root, "util/host.js")).handOverHost({
		workspace: { getConfiguration: () => ({ imageDecodeWorkers: job.pool }) },
		window: { createOutputChannel: () => ({ appendLine() {}, dispose() {} }) },
	});
	console.error = () => undefined;
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "md-image-bench-"));
	const realWorker = sourcePath(job.root, "util/image/imageWorker.js");
	let syncCalls = 0;
	const converters = require(sourcePath(job.root, "util/image/converter.js"));
	const { DDS } = require(sourcePath(job.root, "util/image/dds/index.js"));
	const originalTga = converters.tgaToPng;
	const originalParse = DDS.parse;
	converters.tgaToPng = (...args) => { syncCalls++; return originalTga(...args); };
	DDS.parse = (...args) => { syncCalls++; return originalParse(...args); };
	try {
		const before = memory();
		const tga = Buffer.alloc(18 + job.size * job.size * 4);
		tga[2] = 2;
		tga.writeUInt16LE(job.size, 12);
		tga.writeUInt16LE(job.size, 14);
		tga[16] = 32;
		// Deterministic, incompressible pixels rather than tiny flat-color fixtures.
		let seed = 42;
		for (let i = 18; i < tga.length; i++) {
			seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
			tga[i] = seed & 255;
		}
		const dds = Buffer.alloc(128 + job.size * job.size * 4);
		const put = (i, n) => dds.writeUInt32LE(n >>> 0, i * 4);
		dds.write("DDS "); put(1, 124); put(2, 0x1007); put(3, job.size); put(4, job.size);
		put(19, 32); put(20, 0x41); put(22, 32); put(23, 0x00ff0000);
		put(24, 0x0000ff00); put(25, 0x000000ff); put(26, 0xff000000); put(27, 0x1000);
		tga.copy(dds, 128, 18);
		const sourceHashes = [hash(tga), hash(dds)];
		decoder._setImageWorkerPathForTest(realWorker);
		// Warm every worker to separate dispatch/decoding from cold isolate startup.
		await Promise.all(Array.from({ length: job.pool }, () => decoder.decodeImageToPng(tga.subarray(0), "tga")));
		if (job.blocked) {
			await decoder._terminateImageWorkerForTest();
			const blocked = path.join(temp, "blocked.js");
			fs.writeFileSync(blocked, `const { parentPort } = require('worker_threads');
				parentPort.on('message', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000));`);
			decoder._setImageWorkerPathForTest(blocked);
			decoder._setImageJobTimeoutForTest(150);
		}
		global.gc();
		const ready = memory();
		let peakRss = ready.rss;
		const sampler = setInterval(() => { peakRss = Math.max(peakRss, memory().rss); }, 5);
		const start = performance.now();
		const latencies = [];
		const promises = Array.from({ length: job.jobs }, (_, i) => decoder.decodeImageToPng(i % 2 ? tga : dds, i % 2 ? "tga" : "dds")
			.then((r) => { latencies.push(performance.now() - start); return r; },
				(e) => { latencies.push(performance.now() - start); throw e; }));
		const submitMs = performance.now() - start;
		const submitted = memory();
		peakRss = Math.max(peakRss, submitted.rss);
		const results = await Promise.allSettled(promises);
		const ms = performance.now() - start;
		clearInterval(sampler);
		peakRss = Math.max(peakRss, memory().rss);
		const workerSyncCalls = syncCalls;
		const workersAfter = decoder._getWorkerCountForTest();
		const disabledAfter = decoder._isWorkerPoolDisabledForTest();
		const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason.name);
		let parity = true;
		if (!job.blocked) {
			const expected = [decoder.decodeImageToPngSync(dds, "dds"), decoder.decodeImageToPngSync(tga, "tga")];
			parity = results.every((r, i) => r.status === "fulfilled" && r.value.pngBuffer.equals(expected[i % 2].pngBuffer));
		}
		const outputHash = hash(results.map((r) => r.status === "fulfilled" ? hash(r.value.pngBuffer) : r.reason.name).join("\n"));
		await decoder._terminateImageWorkerForTest();
		decoder._setImageWorkerPathForTest(realWorker);
		decoder._setImageJobTimeoutForTest(30_000);
		const recovery = await decoder.decodeImageToPng(tga, "tga");
		return { ms, submitMs, latencies, bytesTransferred: job.jobs * (dds.length + tga.length) / 2,
			before, ready, submitted, peakRss, after: memory(), maxRssKiB: process.resourceUsage().maxRSS,
			errors, workerSyncCalls, workersAfter, disabledAfter, parity, outputHash,
			sourceIntact: hash(tga) === sourceHashes[0] && hash(dds) === sourceHashes[1], recovery: recovery.width === job.size };
	} finally {
		await decoder._terminateImageWorkerForTest();
		decoder._resetImageWorkerPathForTest();
		fs.rmSync(temp, { recursive: true, force: true });
	}
}

function run(job, timeout) {
	return new Promise((resolve, reject) => {
		const proc = fork(__filename, ["--child", JSON.stringify(job)], { execArgv: ["--expose-gc"], silent: true });
		let result;
		let stderr = "";
		let lastFile;
		let killed = false;
		let timer;
		const reset = () => {
			clearTimeout(timer);
			timer = setTimeout(() => { killed = true; proc.kill("SIGKILL"); }, timeout);
		};
		reset();
		proc.stderr.on("data", (chunk) => { stderr += chunk; });
		proc.stdout.resume();
		proc.on("message", (message) => {
			if (message.progress) { lastFile = message.progress; reset(); }
			if (message.result) { result = message.result; }
		});
		proc.on("error", (e) => { clearTimeout(timer); reject(e); });
		proc.on("close", (code, signal) => {
			clearTimeout(timer);
			if (killed) { resolve({ watchdog: timeout, lastFile, signal }); }
			else if (code !== 0 || !result) { reject(new Error(`child failed: ${code} ${signal} ${stderr}`)); }
			else { resolve(result); }
		});
	});
}

async function main() {
	const [suite, baseline, candidate, output, mod] = process.argv.slice(2);
	if (!["parser", "corpus", "image"].includes(suite) || !output) {
		throw new Error("Usage: node scripts/bench-parser-image.js parser|corpus|image BASELINE CANDIDATE OUTPUT [MOD]");
	}
	const records = [];
	const scenarios = suite === "parser" ? [10, 14, 18, 60].map((pairs) => ({ pairs }))
		: suite === "corpus" ? [{}] : [
			{ size: 512, jobs: 64, pool: 4 },
			{ size: 1024, jobs: 32, pool: 4 },
			{ size: 1024, jobs: 64, pool: 1, blocked: true },
		];
	const repeats = suite === "corpus" ? 2 : 7;
	for (const scenario of scenarios) {
		for (let rep = 0; rep < repeats; rep++) {
			// AB/BA alternation limits monotonic cache/load/thermal bias. Each run is a fresh process.
			for (const variant of rep % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
				const job = { suite, ...scenario, root: path.resolve(variant === "baseline" ? baseline : candidate), mod,
					manifest: `${output}.${variant}.${rep}.manifest.json` };
				const result = await run(job, suite === "parser" ? 3000 : suite === "corpus" ? 10_000 : 60_000);
				if (result.watchdog && !(suite === "parser" && variant === "baseline" && scenario.pairs === 60)) {
					throw new Error(`unexpected watchdog: ${JSON.stringify({ job, result })}`);
				}
				if (suite === "image" && (!result.parity || !result.sourceIntact || !result.recovery || result.workerSyncCalls !== 0 ||
					(scenario.blocked ? result.errors.length !== scenario.jobs || result.errors.some((e) => e !== "ImageDecodeTimeoutError")
						: result.errors.length !== 0))) {
					throw new Error(`image parity/recovery failed: ${JSON.stringify({ job, result })}`);
				}
				records.push({ variant, rep, scenario, result });
				fs.writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform,
					cpu: os.cpus()[0].model, availableParallelism: os.availableParallelism(), repeats, records }, null, 2));
				console.log(JSON.stringify({ suite, variant, rep, scenario, ms: result.ms ?? result.parseMs, watchdog: result.watchdog }));
			}
		}
	}
	if (suite === "corpus" && new Set(records.map((r) => r.result.inputHash + r.result.digest)).size !== 1) {
		throw new Error("corpus inputs or per-file parse values/tokens/failures differ; compare the saved manifests");
	}
}

if (process.argv[2] === "--child") {
	child(JSON.parse(process.argv[3])).then((result) => { process.send({ result }); process.disconnect(); })
		.catch((e) => { console.error(e); process.exitCode = 1; process.disconnect(); });
} else {
	main().catch((e) => { console.error(e); process.exitCode = 1; });
}
