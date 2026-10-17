// Headless audit phases. BENCH_SOURCE_DIR can point to a separately compiled baseline's src.
// MD_FIXTURE is a checkout with common/national_focus; BENCH_KEEP_TOKENS=1 models the old audit.
// Sources are preloaded: this measures application work, never cold filesystem caches.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const out = path.resolve(process.env.BENCH_SOURCE_DIR || 'out-test/src');
if (!process.env.MD_FIXTURE || !global.gc) {
	throw new Error('Use MD_FIXTURE=<mod> node --expose-gc scripts/bench-focus-audit.js');
}
require(path.join(out, 'test/_vscode_stub.js'));
require(path.join(out, 'util/featureflags.js')).getFlags().useConditionInFocus = true;
const { parseHoi4File } = require(path.join(out, 'hoiformat/hoiparser.js'));
const { convertFocusFileNodeToJson } = require(path.join(out, 'previewdef/focustree/schema.js'));
const { collectFocusWarnings, collectFocusWarningsAsync, formatFocusWarningReport } = require(path.join(out, 'previewdef/focustree/warningreport.js'));
const keepTokens = process.env.BENCH_KEEP_TOKENS === '1';
const folder = path.join(process.env.MD_FIXTURE, 'common/national_focus');
const sources = fs.readdirSync(folder).filter(file => file.endsWith('.txt')).sort().map(file => ({
	path: 'common/national_focus/' + file,
	text: fs.readFileSync(path.join(folder, file), 'utf8'),
}));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const immediate = () => new Promise(resolve => setImmediate(resolve));
async function measure(name, fn) {
	await immediate();
	global.gc();
	const before = process.memoryUsage();
	let last = performance.now(), maxGap = 0;
	const heartbeat = setInterval(() => {
		const now = performance.now();
		maxGap = Math.max(maxGap, now - last);
		last = now;
	}, 5);
	const cpu = process.cpuUsage(), start = performance.now();
	const value = await fn();
	const ms = performance.now() - start;
	const usage = process.cpuUsage(cpu);
	await new Promise(resolve => setTimeout(resolve, 10));
	clearInterval(heartbeat);
	const end = process.memoryUsage();
	global.gc();
	console.log(JSON.stringify({ name, ms, maxHeartbeatGapMs: maxGap,
		cpuMs: (usage.user + usage.system) / 1000, heapBefore: before.heapUsed,
		heapEnd: end.heapUsed, heapAfterGC: process.memoryUsage().heapUsed, rss: end.rss }));
	return value;
}
async function main() {
	console.log(JSON.stringify({ node: process.version, keepTokens,
		asyncCollection: !!collectFocusWarningsAsync, files: sources.length,
		bytes: sources.reduce((sum, s) => sum + Buffer.byteLength(s.text), 0),
		fixtures: sources.map(s => ({ path: s.path, sha256: sha(s.text) })),
		note: 'Sample 0 first invocation after module load; 1-3 warm. Preloaded sources, no cold filesystem claim. Heap/RSS endpoints are not peaks. Synchronous parse loop is CPU demand, not production queue responsiveness.' }));
	for (let i = 0; i < 4; i++) {
		const parsed = await measure('parse-' + i, () => sources.map(s => ({ path: s.path,
			file: convertFocusFileNodeToJson(parseHoi4File(s.text, '', { keepTokens }), {}),
		})));
		const warnings = await measure('collect-' + i, () =>
			collectFocusWarningsAsync ? collectFocusWarningsAsync(parsed) : collectFocusWarnings(parsed));
		console.log(JSON.stringify({ sample: i,
			reportSha256: sha(formatFocusWarningReport(warnings, parsed.length)) }));
	}
}
main().catch(e => { console.error(e); process.exitCode = 1; });
