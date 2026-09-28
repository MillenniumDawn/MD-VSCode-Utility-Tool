import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findRepoRoot, ManifestIndex } from './manifest';
import {
	CompatResult, diffBaseline, formatReport, isMissingGameFile, listPreviewFiles, main, normaliseMessage, parseArgs,
	previewTypes, problemKey, readBaseline, runCompat,
} from './runcompat';

// The vanilla-shaped fixture is a mod laid out like the base game, with none of Millennium Dawn's
// extra files. Running every preview over it with no game mounted is what shows a preview reaching
// for a file only one mod has. compat/baseline/vanilla-shaped.json lists what is known to go wrong,
// each tagged with the issue that fixes it; the fix removes its lines.

const repoRoot = findRepoRoot();
const fixture = path.join(repoRoot, 'src', 'test', 'fixtures', 'vanilla-shaped');
const baselineFile = path.join(repoRoot, 'compat', 'baseline', 'vanilla-shaped.json');

describe('compat: vanilla-shaped fixture', function () {
	this.timeout(60000);
	let result: CompatResult;

	before(async () => {
		result = await runCompat({ modDir: fixture, baseline: readBaseline(baselineFile) });
	});

	it('previews at least one file of every type', () => {
		for (const type of previewTypes) {
			assert.ok(result.counts[type].files > 0, `no ${type} file in the fixture`);
		}
	});

	it('raises no problem the baseline does not list', () => {
		assert.deepStrictEqual(result.newProblems.map(problemKey), []);
	});

	it('keeps no baseline entry the run no longer raises', () => {
		assert.deepStrictEqual(result.fixed, [], `Remove these from ${path.relative(repoRoot, baselineFile)}`);
	});

	it('does not count a base-game file that is not mounted', () => {
		assert.ok(result.counts.focustree.ignored > 0);
		assert.strictEqual(result.counts.focustree.problems, 0);
	});
});

describe('compat runner', () => {
	const manifest = new ManifestIndex({
		version: 't', files: ['interface/goals.gfx', 'common/national_focus/00_titlebar_styles.txt'], dirs: ['interface'], sprites: [],
	});

	it('ignores a missing base-game file or image, never a file the game does not have', () => {
		assert.ok(isMissingGameFile("UserError: Can't find file interface/goals.gfx", manifest));
		assert.ok(isMissingGameFile("Can't find file gfx/interface/goals/x.dds", manifest));
		assert.ok(isMissingGameFile('Cannot read common/national_focus/00_titlebar_styles.txt; focus text icons are disabled', manifest));
		assert.ok(!isMissingGameFile("Can't find file interface/MD_decisions.gfx", manifest));
		assert.ok(!isMissingGameFile("Can't find file interface/goals.gfx or interface/MD.gfx", manifest));
		assert.ok(!isMissingGameFile('Unexpected token', manifest));
	});

	it('normalises a message to one line without the machine folders', () => {
		const mod = path.resolve('/work/mod');
		assert.strictEqual(
			normaliseMessage(`UserError: In file ${mod}${path.sep}events${path.sep}x.txt:\n  bad   token\n    at foo (bar.js:1)`, { '<mod>': mod }),
			'UserError: In file <mod>/events/x.txt: bad token');
		assert.strictEqual(normaliseMessage('Circular dependency. Loading loaders: [A],[B]', {}), 'Circular dependency. Loading loaders: …');
		assert.strictEqual(normaliseMessage(`file://${mod.replace(/\\/g, '/')}/a.txt broke`, { '<mod>': mod }), '<mod>/a.txt broke');
		assert.strictEqual(normaliseMessage('x'.repeat(400), {}).length, 301);
	});

	it('lists a preview type\'s own files, recursing only where the preview does', () => {
		assert.deepStrictEqual(listPreviewFiles(fixture, 'decision'), ['common/decisions/generic.txt']);
		assert.deepStrictEqual(listPreviewFiles(fixture, 'gfx'), ['interface/fixture.gfx']);
		assert.deepStrictEqual(listPreviewFiles(path.join(fixture, 'missing'), 'event'), []);
	});

	it('rejects a checkout with no files for a requested preview, even with an empty baseline', async () => {
		await assert.rejects(
			runCompat({ modDir: path.join(fixture, 'common'), only: ['event'], baseline: [], manifest }),
			/No event preview files found under/,
		);
	});

	it('fails only on problems the baseline does not list', () => {
		const a = { type: 'event' as const, file: 'events/a.txt', message: 'a' };
		const b = { type: 'event' as const, file: 'events/b.txt', message: 'b' };
		assert.deepStrictEqual(diffBaseline([a, b], [problemKey(a), 'idea|x|gone']), { newProblems: [b], fixed: ['idea|x|gone'] });
		assert.deepStrictEqual(diffBaseline([a], undefined), { newProblems: [a], fixed: [] });
	});

	it('reads the command line', () => {
		const options = parseArgs(['--mod', 'm', '--game', 'g', '--parent', 'p1', '--parent', 'p2', '--only', 'event,gfx',
			'--baseline', 'b.json', '--update-baseline', '--report', 'r.md', '--label', 'L', '--verbose']);
		assert.strictEqual(options.modDir, path.resolve('m'));
		assert.strictEqual(options.gameDir, path.resolve('g'));
		assert.deepStrictEqual(options.parentDirs, [path.resolve('p1'), path.resolve('p2')]);
		assert.deepStrictEqual(options.only, ['event', 'gfx']);
		assert.strictEqual(options.baselineFile, path.resolve('b.json'));
		assert.strictEqual(options.updateBaseline, true);
		assert.strictEqual(options.reportFile, path.resolve('r.md'));
		assert.strictEqual(options.label, 'L');
		assert.strictEqual(options.verbose, true);
		assert.throws(() => parseArgs([]), /--mod/);
		assert.throws(() => parseArgs(['--mod']), /needs a value/);
		assert.throws(() => parseArgs(['--mod', 'm', '--only', 'map']), /Unknown preview type/);
		assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
	});

	it('reports counts per preview type, new problems and fixed entries', () => {
		const report = formatReport({
			label: 'm', gameMounted: false, gameVersion: '1.0',
			counts: { event: { files: 2, clean: 1, problems: 1, ignored: 3 } } as CompatResult['counts'],
			problems: [{ type: 'event', file: 'events/a.txt', message: 'boom' }],
			newProblems: [{ type: 'event', file: 'events/a.txt', message: 'boom' }],
			fixed: ['idea|x|gone'],
		});
		assert.match(report, /\| event \| 2 \| 1 \| 1 \| 3 \|/);
		assert.match(report, /- `event` events\/a.txt: boom/);
		assert.match(report, /- idea\|x\|gone/);
		assert.match(report, /1\.0 manifest/);
	});

	describe('main', function () {
		this.timeout(60000);
		let dir: string;
		beforeEach(async () => { dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'compat-main-')); });
		afterEach(async () => {
			for (const name of ['b.json', 'summary.md', 'r.md']) {
				const file = path.join(dir, name);
				if (fs.existsSync(file)) {
					await fs.promises.unlink(file);
				}
			}
			await fs.promises.rmdir(dir);
		});

		it('writes the baseline, the report and the job summary, then passes against that baseline', async () => {
			const baseline = path.join(dir, 'b.json');
			const summary = path.join(dir, 'summary.md');
			const report = path.join(dir, 'r.md');
			const out: string[] = [];
			const args = ['--mod', fixture, '--only', 'technology,event', '--baseline', baseline];
			assert.strictEqual(await main([...args, '--update-baseline', '--verbose'], {}, s => out.push(s)), 0);
			const keys: string[] = JSON.parse(fs.readFileSync(baseline, 'utf8'));
			assert.ok(keys.length > 0 && keys.every(k => k.startsWith('technology|')));
			assert.ok(out.some(l => l.startsWith('event events/generic.txt')));

			assert.strictEqual(await main([...args, '--report', report], { GITHUB_STEP_SUMMARY: summary }, () => undefined), 0);
			assert.match(fs.readFileSync(report, 'utf8'), /### Compat: vanilla-shaped/);
			assert.match(fs.readFileSync(summary, 'utf8'), /\| technology \| 1 \|/);

			fs.writeFileSync(baseline, '[]');
			assert.strictEqual(await main(args, {}, () => undefined), 1);
		});

		it('rejects a bad command line', async () => {
			const out: string[] = [];
			assert.strictEqual(await main(['--bogus'], {}, s => out.push(s)), 2);
			assert.match(out.join('\n'), /Usage/);
			assert.strictEqual(await main(['--mod', fixture, '--update-baseline'], {}, () => undefined), 2);
		});
	});
});
