// Run only when other builds/tests/benchmarks are idle. See bench-image-allocation.md for the protocol.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { fork, execFileSync } = require("child_process");
const { createHash } = require("crypto");
const { createRequire } = require("module");
const { performance } = require("perf_hooks");

const hash = (data) => createHash("sha256").update(data).digest("hex");
const memoryFields = ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"];

function fixture({ kind, width, height }) {
	const header = kind === "dds" ? 128 : 18;
	const input = Buffer.alloc(header + width * height * 4);
	if (kind === "dds") {
		const put = (index, value) => input.writeUInt32LE(value >>> 0, index * 4);
		input.write("DDS ");
		put(1, 124); put(2, 0x1007); put(3, height); put(4, width);
		put(19, 32); put(20, 0x41); put(22, 32);
		put(23, 0x00ff0000); put(24, 0x0000ff00); put(25, 0x000000ff); put(26, 0xff000000); put(27, 0x1000);
	} else {
		input[2] = 2;
		input.writeUInt16LE(width, 12);
		input.writeUInt16LE(height, 14);
		input[16] = 32;
		input[17] = 0x28; // top-down BGRA with eight alpha bits
	}
	let seed = 42;
	for (let i = header; i < input.length; i++) {
		seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
		input[i] = seed & 255;
	}
	return input;
}

function child(job) {
	globalThis.IS_WEB_EXT = false;
	process.env.MD_UTILITIES_TEST = "1";
	const rootRequire = createRequire(path.join(job.root, "package.json"));
	const pngjs = rootRequire("pngjs");
	const PNG = pngjs.PNG;
	const TGA = rootRequire("tga");
	const Packer = rootRequire("pngjs/lib/packer");
	const zlib = require("zlib");
	const { DDS } = require(path.join(job.root, "out-test/src/util/image/dds"));
	const { Surface } = require(path.join(job.root, "out-test/src/util/image/dds/surface"));
	const converters = require(path.join(job.root, "out-test/src/util/image/converter"));
	const convert = (input, kind) => kind === "dds"
		? converters.ddsToPng(DDS.parse(input.buffer, input.byteOffset)) : converters.tgaToPng(input);
	// Warm only a tiny image, so no full-sized earlier raster sets the process high-water mark.
	PNG.sync.write(convert(fixture({ kind: job.kind, width: 4, height: 4 }), job.kind));
	const input = fixture(job);
	const inputHash = hash(input);
	const rasterBytes = job.width * job.height * 4;
	global.gc();
	const samples = [];
	let phase = "converter";
	const sample = (event) => samples.push({ phase, event, ...process.memoryUsage() });
	const originals = { alloc: Buffer.alloc, from: Buffer.from, png: PNG, rgba: Surface.prototype.getFullRgba,
		tgaParse: TGA.prototype.parse, filter: Packer.prototype.filterData, deflate: zlib.deflateSync };
	let canvasBytes = 0;
	let copiedRgbaBytes = 0;
	let wrappedRgbaBytes = 0;
	try {
		Buffer.alloc = function (size, ...args) {
			const result = originals.alloc(size, ...args);
			if (phase === "converter" && size === rasterBytes) {
				canvasBytes += size;
				sample("full-raster-buffer-allocated");
			}
			return result;
		};
		Buffer.from = function (value, ...args) {
			const result = originals.from(value, ...args);
			if (phase === "converter" && ArrayBuffer.isView(value) && value.byteLength === rasterBytes) {
				copiedRgbaBytes += value.byteLength;
				sample("rgba-copied");
			} else if (phase === "converter" && value instanceof ArrayBuffer && args[1] === rasterBytes) {
				wrappedRgbaBytes += rasterBytes;
				sample("rgba-wrapped");
			}
			return result;
		};
		pngjs.PNG = new Proxy(PNG, { construct(target, args, newTarget) {
			const result = Reflect.construct(target, args, newTarget);
			sample("png-object-created");
			return result;
		} });
		Surface.prototype.getFullRgba = function () {
			const result = originals.rgba.call(this);
			sample("dds-rgba-decoded");
			return result;
		};
		TGA.prototype.parse = function () {
			originals.tgaParse.call(this);
			sample("tga-rgba-decoded");
		};
		Packer.prototype.filterData = function (...args) {
			const result = originals.filter.apply(this, args);
			sample("png-filter-complete");
			return result;
		};
		zlib.deflateSync = function (...args) {
			const result = originals.deflate.apply(this, args);
			sample("png-deflate-complete");
			return result;
		};
		sample("before-convert");
		const convertStart = performance.now();
		const png = convert(input, job.kind);
		const convertMs = performance.now() - convertStart;
		sample("after-convert");
		assert.strictEqual(png.width, job.width);
		assert.strictEqual(png.height, job.height);
		assert.strictEqual(png.data.length, rasterBytes);
		const rgbaHash = hash(png.data);
		phase = "encode";
		sample("before-encode");
		const encodeStart = performance.now();
		const output = PNG.sync.write(png);
		const encodeMs = performance.now() - encodeStart;
		sample("after-encode");
		const phasePeak = (wanted) => Object.fromEntries(memoryFields.map((field) => [field,
			Math.max(...samples.filter((s) => s.phase === wanted).map((s) => s[field]))]));
		return { convertMs, encodeMs, totalMs: convertMs + encodeMs, rasterBytes, inputBytes: input.length,
			canvasBytes, copiedRgbaBytes, wrappedRgbaBytes, samples, converterPeak: phasePeak("converter"),
			encodePeak: phasePeak("encode"), maxRssKiB: process.resourceUsage().maxRSS,
			inputHash, rgbaHash, outputHash: hash(output), outputBytes: output.length,
			sourceIntact: hash(input) === inputHash, rgbaIntact: hash(png.data) === rgbaHash };
	} finally {
		Buffer.alloc = originals.alloc;
		Buffer.from = originals.from;
		pngjs.PNG = originals.png;
		Surface.prototype.getFullRgba = originals.rgba;
		TGA.prototype.parse = originals.tgaParse;
		Packer.prototype.filterData = originals.filter;
		zlib.deflateSync = originals.deflate;
	}
}

function run(job) {
	return new Promise((resolve, reject) => {
		const proc = fork(__filename, ["--child", JSON.stringify(job)], { execArgv: ["--expose-gc"], silent: true });
		let result;
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, 60_000);
		proc.stdout.resume();
		proc.stderr.on("data", (chunk) => { stderr += chunk; });
		proc.on("message", (message) => { result = message; });
		proc.on("error", (error) => { clearTimeout(timer); reject(error); });
		proc.on("close", (code, signal) => {
			clearTimeout(timer);
			if (timedOut || code !== 0 || !result) {
				reject(new Error(`image benchmark child failed: timeout=${timedOut} exit=${code} signal=${signal} ${stderr}`));
			} else {
				resolve(result);
			}
		});
	});
}

async function main() {
	const [baseline, candidate, output] = process.argv.slice(2);
	if (!baseline || !candidate || !output) {
		throw new Error("Usage: node scripts/bench-image-allocation.js BASELINE CANDIDATE OUTPUT");
	}
	const roots = { baseline: path.resolve(baseline), candidate: path.resolve(candidate) };
	const revision = (root) => execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	const compiledHash = (root) => hash(fs.readFileSync(path.join(root, "out-test/src/util/image/converter.js")));
	const records = [];
	const evidence = { node: process.version, platform: process.platform, cpu: os.cpus()[0].model,
		availableParallelism: os.availableParallelism(), repeats: 7,
		roots, revisions: Object.fromEntries(Object.entries(roots).map(([variant, root]) => [variant, revision(root)])),
		compiledConverterHashes: Object.fromEntries(Object.entries(roots).map(([variant, root]) => [variant, compiledHash(root)])), records };
	const scenarios = [512, 2048, 4096].flatMap((width) => ["dds", "tga"].map((kind) =>
		({ kind, width, height: width === 4096 ? 2048 : width })));
	for (const scenario of scenarios) {
		let expected;
		for (let rep = 0; rep < evidence.repeats; rep++) {
			for (const variant of rep % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
				const result = await run({ root: roots[variant], ...scenario });
				assert.ok(result.sourceIntact && result.rgbaIntact, "conversion or encoding mutated source pixels");
				const parity = [result.inputHash, result.rgbaHash, result.outputHash, result.outputBytes];
				if (!expected) { expected = parity; }
				assert.deepStrictEqual(parity, expected, "baseline/candidate/repeat PNG or pixel mismatch");
				records.push({ variant, rep, scenario, result });
				fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
				console.log(JSON.stringify({ variant, rep, scenario, convertMs: result.convertMs,
					encodeMs: result.encodeMs, arrayBuffers: result.converterPeak.arrayBuffers, rss: result.converterPeak.rss }));
			}
		}
	}
}

if (process.argv[2] === "--child") {
	try { process.send(child(JSON.parse(process.argv[3]))); }
	catch (error) { console.error(error); process.exitCode = 1; }
	finally { process.disconnect(); }
} else {
	main().catch((error) => { console.error(error); process.exitCode = 1; });
}
