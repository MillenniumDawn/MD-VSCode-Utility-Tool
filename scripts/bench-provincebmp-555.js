// Issue #555 benchmark for getProvincesByPosition.
// Run: npm run compile-test && node --expose-gc scripts/bench-provincebmp-555.js
// The baseline below is pinned to base 65b14305551288be19a4380731133c9d655dc452. The
// candidate is loaded from the compiled production module through a temporary export so the
// extension's module API stays private.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const repoRoot = path.resolve(__dirname, '..');
const compiledFile = path.join(
	repoRoot,
	'out-test',
	'src',
	'previewdef',
	'worldmap',
	'loader',
	'provincebmp.js',
);
if (!fs.existsSync(compiledFile)) {
	console.error('out-test is missing. Run `npm run compile-test` first.');
	process.exit(1);
}
if (typeof global.gc !== 'function') {
	console.error('Run with `node --expose-gc` so each timed sample starts after collection.');
	process.exit(1);
}

require(path.join(repoRoot, 'out-test', 'src', 'test', '_vscode_stub.js'));
const provinceModule = new Module(compiledFile, module);
provinceModule.filename = compiledFile;
provinceModule.paths = Module._nodeModulePaths(path.dirname(compiledFile));
provinceModule._compile(
	fs.readFileSync(compiledFile, 'utf8') + '\nexports.__benchGetProvincesByPosition = getProvincesByPosition;\n',
	compiledFile,
);
const candidate = provinceModule.exports.__benchGetProvincesByPosition;

const WIDTH = 5632;
const HEIGHT = 2048;
const PROVINCE_COUNT = 11500;
const PAIRS = Number(process.env.BENCH_PAIRS || 11);
const WARMUPS = 2;

// Original implementation at base 65b1430. Keep this copy fixed so later runs continue to
// compare the candidate against the exact issue base after the production source has changed.
function baseline(provinceMapImage) {
	const colorByPosition = new Uint32Array(
		provinceMapImage.width * provinceMapImage.height,
	);
	const bitmapData = provinceMapImage.data;
	const provinces = [];
	const colorToProvince = {};
	for (
		let y = provinceMapImage.height - 1,
			sy = 0,
			dy = (provinceMapImage.height - 1) * provinceMapImage.width;
		y >= 0;
		y--, sy += provinceMapImage.bytesPerRow, dy -= provinceMapImage.width
	) {
		for (
			let x = 0, sx = sy, dx = dy;
			x < provinceMapImage.width;
			x++, sx += 3, dx++
		) {
			const blue = bitmapData[sx + 2] ?? 0;
			const green = bitmapData[sx + 1] ?? 0;
			const red = bitmapData[sx] ?? 0;
			const color = (blue << 16) | (green << 8) | red;
			const province = colorToProvince[color];
			if (province === undefined) {
				const newProvince = { color };
				provinces.push(newProvince);
				colorToProvince[color] = newProvince;
				colorByPosition[dx] = color;
			} else {
				colorByPosition[dx] = province.color;
			}
		}
	}
	return { colorByPosition, provinces };
}

// Paged-LUT alternative retained here for the controlled comparison requested in issue #555.
function pagedColorLookup(provinceMapImage) {
	const colorByPosition = new Uint32Array(
		provinceMapImage.width * provinceMapImage.height,
	);
	const bitmapData = provinceMapImage.data;
	const provinces = [];
	const pages = new Array(1 << 16);
	for (
		let y = provinceMapImage.height - 1,
			sy = 0,
			dy = (provinceMapImage.height - 1) * provinceMapImage.width;
		y >= 0;
		y--, sy += provinceMapImage.bytesPerRow, dy -= provinceMapImage.width
	) {
		for (
			let x = 0, sx = sy, dx = dy;
			x < provinceMapImage.width;
			x++, sx += 3, dx++
		) {
			const blue = bitmapData[sx + 2] ?? 0;
			const green = bitmapData[sx + 1] ?? 0;
			const red = bitmapData[sx] ?? 0;
			const color = (blue << 16) | (green << 8) | red;
			const high = color >>> 8;
			let page = pages[high];
			if (page === undefined) {
				page = pages[high] = new Uint32Array(256);
			}
			let provinceId = page[color & 0xff];
			if (provinceId === 0) {
				provinceId = provinces.length + 1;
				page[color & 0xff] = provinceId;
				provinces.push({ color });
			}
			colorByPosition[dx] = color;
		}
	}
	return { colorByPosition, provinces };
}

function makeBmp() {
	const bytesPerRow = WIDTH * 3;
	const data = Buffer.alloc(WIDTH * HEIGHT * 3);
	// An odd multiplier permutes the 24-bit domain, yielding 11,500 distinct spread-out colors.
	const colors = Array.from(
		{ length: PROVINCE_COUNT },
		(_, i) => Math.imul(i, 0x9e3779b1) & 0xffffff,
	);
	for (let y = 0; y < HEIGHT; y++) {
		const provinceBand = Math.floor(y / 16) * (WIDTH / 32);
		for (let x = 0; x < WIDTH; x++) {
			const color = colors[(provinceBand + Math.floor(x / 32)) % PROVINCE_COUNT];
			const offset = (y * WIDTH + x) * 3;
			data[offset] = color & 0xff;
			data[offset + 1] = (color >>> 8) & 0xff;
			data[offset + 2] = (color >>> 16) & 0xff;
		}
	}
	return {
		width: WIDTH,
		height: HEIGHT,
		bitsPerPixel: 24,
		bytesPerRow,
		data,
		colorPageCount: new Set(colors.map((color) => color >>> 8)).size,
	};
}

function makeBmpOfUniqueColors(width, height) {
	const data = Buffer.alloc(width * height * 3);
	for (let i = 0; i < width * height; i++) {
		data[i * 3] = i & 0xff;
		data[i * 3 + 1] = (i >>> 8) & 0xff;
		data[i * 3 + 2] = (i >>> 16) & 0xff;
	}
	return { width, height, bitsPerPixel: 24, bytesPerRow: width * 3, data };
}

function sameOutput(expected, actual) {
	assert.deepStrictEqual(actual.provinces, expected.provinces);
	assert.ok(Buffer.from(actual.colorByPosition.buffer).equals(Buffer.from(expected.colorByPosition.buffer)));
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function timed(fn, bmp) {
	global.gc();
	const started = process.hrtime.bigint();
	const result = fn(bmp);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	return { elapsedMs, result };
}

function main() {
	const bmp = makeBmp();
	const reference = baseline(bmp);
	assert.strictEqual(reference.provinces.length, PROVINCE_COUNT);
	const implementations = [
		{ name: 'Last-color cache', fn: candidate, memory: 'Two scalar references; no additional table.' },
		{ name: 'Paged LUT', fn: pagedColorLookup, memory: 'About 6.45 MiB for this palette; up to 64.5 MiB worst case.' },
	];
	for (const implementation of implementations) {
		sameOutput(reference, implementation.fn(bmp));
	}
	const overflowBmp = makeBmpOfUniqueColors(256, 256);
	for (const implementation of implementations) {
		sameOutput(baseline(overflowBmp), implementation.fn(overflowBmp));
	}

	for (let i = 0; i < WARMUPS; i++) {
		baseline(bmp);
		for (const implementation of implementations) {
			implementation.fn(bmp);
		}
	}
	const samples = new Map(implementations.map(({ name }) => [name, { baseline: [], candidate: [] }]));
	for (let pair = 0; pair < PAIRS; pair++) {
		for (let i = 0; i < implementations.length; i++) {
			const implementation = implementations[i];
			let order;
			if ((pair + i) % 2 === 0) {
				order = [['baseline', baseline], ['candidate', implementation.fn]];
			} else {
				order = [['candidate', implementation.fn], ['baseline', baseline]];
			}
			for (const [name, fn] of order) {
				const measurement = timed(fn, bmp);
				samples.get(implementation.name)[name].push(measurement.elapsedMs);
			}
		}
	}

	const cpu = os.cpus()[0];
	const tableBytes = 65536 * 8 + bmp.colorPageCount * 256 * 4;
	console.log(`Node ${process.version}; ${process.platform}/${process.arch}; ${os.release()}`);
	console.log(`CPU ${cpu ? cpu.model : 'unavailable'}; ${os.cpus().length} logical CPUs`);
	console.log(`Map ${WIDTH}x${HEIGHT}; ${(WIDTH * HEIGHT).toLocaleString()} pixel lookups; 24-bit; ${PROVINCE_COUNT} distinct generated colors; ${bmp.data.byteLength.toLocaleString()} input bytes.`);
	console.log(`Correctness: exact province ordering and byte-identical colorByPosition on the large fixture and on a 256x256 fixture with 65,536 unique colors.`);
	console.log(`Samples: ${PAIRS} baseline/candidate pairs per candidate, alternating order; ${WARMUPS} untimed warmups each.`);
	console.log(`Memory estimate: output Uint32Array is ${(WIDTH * HEIGHT * 4 / 1048576).toFixed(1)} MiB in all; paged table about ${(tableBytes / 1048576).toFixed(2)} MiB for this palette.`);
	console.log('\n| Implementation | Paired baseline samples (ms) | Candidate samples (ms) | Median baseline | Median candidate | Paired speedup | Baseline range | Candidate range | Memory tradeoff |');
	console.log('|---|---|---|---:|---:|---:|---:|---:|---|');
	for (const implementation of implementations) {
		const { baseline: baseValues, candidate: candidateValues } = samples.get(implementation.name);
		const pairedSpeedups = candidateValues.map((value, index) => baseValues[index] / value - 1);
		console.log(`| ${implementation.name} | ${baseValues.map((v) => v.toFixed(2)).join(', ')} | ${candidateValues.map((v) => v.toFixed(2)).join(', ')} | ${median(baseValues).toFixed(2)} ms | ${median(candidateValues).toFixed(2)} ms | ${(median(pairedSpeedups) * 100).toFixed(1)}% | ${Math.min(...baseValues).toFixed(2)}–${Math.max(...baseValues).toFixed(2)} ms | ${Math.min(...candidateValues).toFixed(2)}–${Math.max(...candidateValues).toFixed(2)} ms | ${implementation.memory} |`);
	}
	console.log('Input generation is outside the timer; output and lookup allocations are timed. GC runs before, not during, each sample.');
}

main();
