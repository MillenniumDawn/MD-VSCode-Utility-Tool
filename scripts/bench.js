// Micro-benchmarks for the hot paths an audit touches.
//
// These are the paths that run over millions of tokens (the tokenizer), over every condition
// leaf in a file (condition extraction), over every CSS rule and every escaped string in a
// render, and over every pixel of a province bitmap. None of them are covered by a timing
// assertion anywhere else, so a regression in one is invisible until someone reports the
// editor feeling slow.
//
// Run:   npm run bench
// Needs: out-test/ (npm run compile-test), because that build also carries the vscode stub
//        the render and world-map modules need in order to load outside the extension host.
//
// Fixture data is generated, so the numbers are comparable between machines only against
// themselves. Compare a before and an after on one machine; do not compare across machines.
// Point BENCH_FOCUS_FILE at a real focus file to run the parser and condition scenarios over
// mod content instead of the generated stand-in.

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'out-test', 'src');

if (!fs.existsSync(outDir)) {
	console.error('out-test/ is missing. Run `npm run compile-test` first.');
	process.exit(1);
}

// Installs the `vscode` module stub and the compile-time globals. Must come before any
// require of a compiled source file.
require(path.join(repoRoot, 'out-test', 'src', 'test', '_vscode_stub.js'));

const { parseHoi4File } = require(path.join(outDir, 'hoiformat', 'hoiparser.js'));
const { extractConditionValue } = require(path.join(outDir, 'hoiformat', 'condition.js'));
const { countryScope } = require(path.join(outDir, 'hoiformat', 'scope.js'));
const { htmlEscape } = require(path.join(outDir, 'util', 'html.js'));
const { StyleTable } = require(path.join(outDir, 'util', 'styletable.js'));
const { fillEdges } = require(path.join(outDir, 'previewdef', 'worldmap', 'loader', 'provincebmp.js'));

// --- fixtures ---------------------------------------------------------------------------

// A focus file shaped like the ones that make a preview slow: many focuses, each with a
// nested trigger block, and a mix of scope changes so tryMoveScope is exercised per node.
//
// The conditions are deliberately *distinct* per focus. Repeating a handful of flags across
// every focus saturates the shared expression accumulator at a few dozen entries and hides
// the cost of scanning it, which is not what a real tree looks like: focuses gate on their
// own flags, their own tags and their own techs, so the accumulator grows with the file.
function generateFocusFile(focusCount) {
	const parts = ['focus_tree = {', '\tid = bench_tree'];
	for (let i = 0; i < focusCount; i++) {
		parts.push(
			`\tfocus = {`,
			`\t\tid = bench_focus_${i}`,
			`\t\ticon = GFX_goal_generic_${i % 40}`,
			`\t\tx = ${i % 20}`,
			`\t\ty = ${Math.floor(i / 20)}`,
			`\t\tcost = 10`,
			`\t\tprerequisite = { focus = bench_focus_${Math.max(0, i - 1)} }`,
			`\t\tavailable = {`,
			`\t\t\tOR = {`,
			`\t\t\t\thas_country_flag = bench_flag_${i}`,
			`\t\t\t\tAND = {`,
			`\t\t\t\t\thas_government = bench_gov_${i}`,
			`\t\t\t\t\tNOT = { has_war_with = bench_target_${i} }`,
			`\t\t\t\t}`,
			`\t\t\t\tany_owned_state = { is_core_of = ROOT compare = ${i} }`,
			`\t\t\t}`,
			`\t\t\thas_tech = bench_tech_${i}`,
			`\t\t}`,
			`\t\tcompletion_reward = {`,
			`\t\t\tadd_political_power = ${50 + (i % 100)}`,
			`\t\t\tevery_owned_state = { add_extra_state_shared_building_slots = 1 }`,
			`\t\t}`,
			`\t}`,
		);
	}
	parts.push('}');
	return parts.join('\n');
}

function loadFocusSource() {
	const override = process.env.BENCH_FOCUS_FILE;
	if (override) {
		if (!fs.existsSync(override)) {
			console.error(`BENCH_FOCUS_FILE does not exist: ${override}`);
			process.exit(1);
		}
		return { label: path.basename(override), text: fs.readFileSync(override, 'utf8') };
	}
	return { label: 'generated (600 focuses)', text: generateFocusFile(600) };
}

// A province bitmap small enough to run in a second but shaped like a real one: irregular
// blobs, so borders are long and concatEdges has real paths to join rather than 4-segment
// squares.
function generateProvinceGrid(width, height, provinceSize) {
	const colorByPosition = new Uint32Array(width * height);
	const colorToProvince = {};
	const provinces = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// Offset every other band so province edges are ragged rather than a clean grid.
			const band = Math.floor(y / provinceSize);
			const shift = (band % 2) * Math.floor(provinceSize / 2);
			const cell = Math.floor((x + shift) / provinceSize);
			const color = band * 4096 + cell + 1;
			colorByPosition[y * width + x] = color;
			if (colorToProvince[color] === undefined) {
				const province = { color, warnings: [] };
				colorToProvince[color] = province;
				provinces.push(province);
			}
		}
	}
	return { provinces, colorToProvince, colorByPosition, width, height };
}

// --- timing -----------------------------------------------------------------------------

const results = [];

function bench(name, detail, iterations, fn) {
	// One untimed pass so the timed ones measure steady state rather than first-call compile.
	fn();
	const started = process.hrtime.bigint();
	for (let i = 0; i < iterations; i++) {
		fn();
	}
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	const perIteration = elapsedMs / iterations;
	results.push({ name, detail, perIteration });
	console.log(`  ${name.padEnd(28)} ${perIteration.toFixed(2).padStart(9)} ms   (${detail})`);
}

function main() {
	const focus = loadFocusSource();
	console.log(`\nFixtures: focus source = ${focus.label}, ${(focus.text.length / 1024).toFixed(0)} KiB\n`);

	console.log('Benchmarks (lower is better):');

	// 1. Tokenizer + node tree. keepTokens:false is what the index builds use; the previews
	//    keep tokens, so time the heavier of the two.
	bench('parseHoi4File', `${(focus.text.length / 1024).toFixed(0)} KiB`, 5, () => {
		parseHoi4File(focus.text, '');
	});

	// 2. Condition extraction over every trigger in that file, accumulating into one shared
	//    exprs array -- the arrangement the preview schemas actually use.
	const parsed = parseHoi4File(focus.text, '');
	const triggerNodes = collectTriggerNodes(parsed);
	bench('extractConditionValue', `${triggerNodes.length} trigger blocks`, 5, () => {
		const exprs = [];
		for (const node of triggerNodes) {
			extractConditionValue(node.value, countryScope, exprs);
		}
	});

	// 3. The render path: one big style table plus the escaping every content builder runs
	//    over mod-supplied text.
	bench('StyleTable.toRawCss', '10000 rules, called twice', 5, () => {
		const table = new StyleTable();
		for (let i = 0; i < 10000; i++) {
			table.oneTimeStyle('bench-item', () => `\n    left: ${i}px;\n    top: ${i * 2}px;\n`);
		}
		// Every content builder calls it once for the <style> block and once for update.styleCss.
		table.toRawCss();
		table.toRawCss();
	});

	const escapeInput = Array.from(
		{ length: 2000 },
		(_, i) => `Focus <b>"bench_${i}"</b> & its 'tooltip' text\nwith a second line`,
	);
	bench('htmlEscape', `${escapeInput.length} strings`, 20, () => {
		for (const value of escapeInput) {
			htmlEscape(value);
		}
	});

	// 4. The province bitmap pass: per-pixel flood fill plus border path assembly.
	const grid = generateProvinceGrid(512, 512, 12);
	bench('fillEdges', `512x512, ${grid.provinces.length} provinces`, 3, () => {
		// fillEdges mutates province.edges, so hand it a fresh set each run.
		const provinces = grid.provinces.map((p) => ({ color: p.color, warnings: [] }));
		const colorToProvince = {};
		for (const province of provinces) {
			colorToProvince[province.color] = province;
		}
		fillEdges(provinces, colorToProvince, grid.colorByPosition, grid.width, grid.height);
	});

	console.log('\nMarkdown (paste into the pull request):\n');
	console.log('| Benchmark | Time | Fixture |');
	console.log('|---|---|---|');
	for (const r of results) {
		console.log(`| \`${r.name}\` | ${r.perIteration.toFixed(2)} ms | ${r.detail} |`);
	}
	console.log('');
}

// Every `available`/`trigger`/`visible` block in the parsed tree -- the condition-shaped
// nodes a focus tree preview extracts.
function collectTriggerNodes(node, into = []) {
	if (!node || typeof node !== 'object') {
		return into;
	}
	if (Array.isArray(node)) {
		for (const child of node) {
			collectTriggerNodes(child, into);
		}
		return into;
	}
	const name = node.name;
	if (name === 'available' || name === 'trigger' || name === 'visible' || name === 'allowed') {
		into.push(node);
	}
	collectTriggerNodes(node.value, into);
	return into;
}

main();
