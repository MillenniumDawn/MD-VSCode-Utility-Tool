import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
	AllowlistEntry, ManifestIndex, checkHardcoded, findRepoRoot, formatHit, loadManifest, scanHardcoded, scanPackageDefaults,
} from './compat/manifest';

// Every game path and `GFX_` sprite the extension's source names has to exist in the base game,
// or be allowlisted with a reason. #448–#451 were Millennium Dawn-only names that made a preview go
// quiet everywhere else, and nothing caught them because every fixture was written by hand.

const repoRoot = findRepoRoot();
const allowlistFile = path.join(repoRoot, 'compat', 'hardcoded-allowlist.json');

function sourceFiles(dir: string): string[] {
	const result: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (full !== path.join(repoRoot, 'src', 'test')) {
				result.push(...sourceFiles(full));
			}
		} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
			result.push(full);
		}
	}
	return result;
}

function allHits() {
	const hits = sourceFiles(path.join(repoRoot, 'src')).flatMap(file =>
		scanHardcoded(fs.readFileSync(file, 'utf8'), path.relative(repoRoot, file).replace(/\\/g, '/')));
	return [...hits, ...scanPackageDefaults(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))];
}

describe('hardcoded game paths', () => {
	const index = new ManifestIndex(loadManifest());
	const allowlist: AllowlistEntry[] = JSON.parse(fs.readFileSync(allowlistFile, 'utf8'));

	it('names only files, folders and sprites the base game has, or allowlisted ones', () => {
		const { missing } = checkHardcoded(allHits(), index, allowlist);
		assert.deepStrictEqual(missing.map(formatHit), [],
			`Not in the base game ${index.manifest.version} and not in compat/hardcoded-allowlist.json:\n`
			+ missing.map(formatHit).join('\n'));
	});

	it('keeps no allowlist entry the source no longer uses', () => {
		const { stale } = checkHardcoded(allHits(), index, allowlist);
		assert.deepStrictEqual(stale.map(e => e.value), [], 'Remove these from compat/hardcoded-allowlist.json');
	});

	it('gives every allowlist entry a reason', () => {
		for (const entry of allowlist) {
			assert.ok(typeof entry.reason === 'string' && entry.reason.trim() !== '', `${entry.value} has no reason`);
		}
	});

	it('names the file and line of a name the base game does not have', () => {
		const source = 'const a = "interface/goals.gfx";\nconst b = "interface/MD_only.gfx";\n';
		const { missing } = checkHardcoded(scanHardcoded(source, 'src/x.ts'), index, []);
		assert.deepStrictEqual(missing.map(formatHit), ['src/x.ts:2  interface/MD_only.gfx']);
	});

	it('passes a name once it is allowlisted', () => {
		const hits = scanHardcoded('const b = "interface/MD_only.gfx";', 'src/x.ts');
		const result = checkHardcoded(hits, index, [{ value: 'interface/MD_only.gfx', reason: 'test' }]);
		assert.deepStrictEqual(result, { missing: [], stale: [] });
	});
});

describe('scanHardcoded', () => {
	const values = (source: string) => scanHardcoded(source, 'x.ts').map(h => [h.value, h.prefix]);

	it('reads literals, template heads and the left side of a concatenation', () => {
		assert.deepStrictEqual(values([
			'const a = "interface/goals.gfx";',
			'const b = `GFX_decision_${icon}`;',
			'const c = "map/" + name;',
			'const d = name + "gfx/x.dds";',
			'const e = ["common", "decisions", "*"];',
			'const f = \'common/ideas/*.txt\';',
			'const g = "not a path";',
		].join('\n')), [
			['interface/goals.gfx', false],
			['GFX_decision_', true],
			['map/', true],
			['gfx/x.dds', false],
			['common', false],
			['common/ideas/', true],
		]);
	});

	it('checks fully static concatenations as exact names, including nested parts', () => {
		assert.deepStrictEqual(values('const a = "interface/" + "MD_only.gfx";'),
			[['interface/MD_only.gfx', false]]);
		assert.deepStrictEqual(values('const b = ("interface/" + "MD_") + suffix;'),
			[['interface/MD_', true]]);
		const { missing } = checkHardcoded(scanHardcoded('const a = "interface/" + "MD_only.gfx";', 'x.ts'),
			new ManifestIndex({ version: 't', files: ['interface/goals.gfx'], dirs: ['interface'], sprites: [] }), []);
		assert.deepStrictEqual(missing.map(formatHit), ['x.ts:1  interface/MD_only.gfx']);
	});

	it('ignores module specifiers', () => {
		assert.deepStrictEqual(values('import x from "common/x";\nexport * from "gfx/y";'), []);
	});

	it('reads string setting defaults from package.json', () => {
		const pkg = JSON.stringify({
			contributes: { configuration: { properties: {
				a: { default: ['interface/scripted_gui'] },
				b: { default: 'zoom' },
				c: { default: { roots: 'gfx/interface' } },
			} } },
		}, undefined, '\t');
		assert.deepStrictEqual(scanPackageDefaults(pkg).map(formatHit),
			['package.json:7  interface/scripted_gui', 'package.json:15  gfx/interface']);
	});
});

describe('ManifestIndex', () => {
	const index = new ManifestIndex({
		version: 't', files: ['interface/Goals.gfx'], dirs: ['interface', 'common/ideas'], sprites: ['GFX_focus_link_up_down'],
	});

	it('matches without regard to case or a trailing slash', () => {
		assert.ok(index.hasFile('INTERFACE/goals.gfx'));
		assert.ok(index.hasDir('common/ideas/'));
		assert.ok(index.hasSprite('gfx_focus_link_up_down'));
		assert.ok(!index.hasFile('interface/other.gfx'));
	});

	it('matches a prefix against every kind of name', () => {
		assert.ok(index.hasPrefix('GFX_focus_link_'));
		assert.ok(index.hasPrefix('common/id'));
		assert.ok(!index.hasPrefix('GFX_decision_'));
		assert.ok(!index.hasPrefix('zzz'));
	});
});
