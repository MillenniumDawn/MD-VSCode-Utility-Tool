import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

const manifestScript = require('../../../scripts/vanilla-manifest');
const checkoutScript = require('../../../scripts/compat-checkout');

describe('scripts/vanilla-manifest', () => {
	let dir: string;
	beforeEach(async () => { dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'manifest-')); });
	afterEach(async () => { await fs.promises.rm(dir, { recursive: true, force: true }); });

	const write = (relative: string, content: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
		fs.writeFileSync(path.join(dir, relative), content);
	};

	it('records paths, sprite names and the game version, and no content', () => {
		write('launcher-settings.json', JSON.stringify({ rawVersion: '1.2.3' }));
		write('interface/goals.gfx', 'spriteTypes = {\n\tspriteType = { name = "GFX_goal_a" texturefile = "x.dds" }\n\tSpriteType = { name = GFX_goal_b }\n}');
		write('common/ideas/a.txt', 'ideas = { }');
		write('gfx/interface/x.dds', 'binary');
		write('music/ignored.ogg', 'x');

		const manifest = manifestScript.buildManifest(dir);
		assert.deepStrictEqual(manifest, {
			version: '1.2.3',
			files: ['common/ideas/a.txt', 'gfx/interface/x.dds', 'interface/goals.gfx'],
			dirs: ['common', 'common/ideas', 'gfx', 'gfx/interface', 'interface'],
			sprites: ['GFX_goal_a', 'GFX_goal_b'],
		});

		const out = path.join(dir, 'out', 'm.json.gz');
		manifestScript.writeManifest(manifest, out);
		assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(out)).toString()), manifest);
	});

	it('refuses a folder that is not a game install', () => {
		assert.throws(() => manifestScript.buildManifest(dir), /No game files/);
	});
});

describe('scripts/compat-checkout', () => {
	const mods = [
		{ id: 'base', repo: 'o/base', ref: 'a'.repeat(40), paths: ['common'], parents: [] },
		{ id: 'sub', repo: 'o/sub', ref: 'b'.repeat(40), paths: ['common', 'events'], parents: ['base'] },
	];

	it('checks out parents first, each once', () => {
		assert.deepStrictEqual(checkoutScript.resolveOrder(mods, 'sub').map((m: { id: string }) => m.id), ['base', 'sub']);
		assert.throws(() => checkoutScript.resolveOrder(mods, 'nope'), /not listed/);
	});

	it('hands the runner the mod and its parents', () => {
		const root = path.resolve('r');
		assert.deepStrictEqual(checkoutScript.runnerArgs(checkoutScript.resolveOrder(mods, 'sub'), root),
			['--mod', path.join(root, 'sub'), '--parent', path.join(root, 'base')]);
	});

	it('fetches only the pinned commit and the listed folders', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'checkout-'));
		try {
			const calls: string[] = [];
			assert.strictEqual(checkoutScript.checkout(mods[1], path.join(dir, 'sub'), (args: string[]) => { calls.push(args.join(' ')); return ''; }), true);
			assert.deepStrictEqual(calls, [
				'init --quiet',
				'remote add origin https://github.com/o/sub.git',
				'sparse-checkout set common events',
				`fetch --quiet --depth=1 --filter=blob:none origin ${'b'.repeat(40)}`,
				'checkout --quiet FETCH_HEAD',
			]);
		} finally {
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});

	it('reads the listed mods', () => {
		assert.ok(checkoutScript.readMods().length > 0);
	});
});
