import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { findRepoRoot } from './compat/manifest';

// compat/mods.json is the only place a real mod is named. The compat workflow builds its matrix
// from it, so a mod's id or repository turning up in the extension or its workflows is the
// hardcoding the compat check exists to catch, not a way around it.

interface ModEntry {
	id: string;
	repo: string;
	ref: string;
	paths: string[];
	parents: string[];
}

const repoRoot = findRepoRoot();
const mods: ModEntry[] = JSON.parse(fs.readFileSync(path.join(repoRoot, 'compat', 'mods.json'), 'utf8'));

function filesUnder(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(full) : [full];
	});
}

describe('compat/mods.json', () => {
	it('lists at least one mod', () => {
		assert.ok(mods.length > 0);
	});

	it('pins every mod to a commit and names only folders to check out', () => {
		const ids = new Set<string>();
		for (const mod of mods) {
			assert.match(mod.id, /^[a-z0-9-]+$/, `id ${mod.id}`);
			assert.ok(!ids.has(mod.id), `${mod.id} is listed twice`);
			ids.add(mod.id);
			assert.match(mod.repo, /^[\w.-]+\/[\w.-]+$/, `${mod.id}: repo`);
			assert.match(mod.ref, /^[0-9a-f]{40}$/, `${mod.id}: ref must be a full commit SHA`);
			assert.ok(Array.isArray(mod.paths) && mod.paths.length > 0, `${mod.id}: paths`);
			assert.ok(!mod.paths.some(p => /^gfx(\/|$)/i.test(p)), `${mod.id}: gfx/ is too large to check out`);
			assert.ok(fs.existsSync(path.join(repoRoot, 'compat', 'baseline', `${mod.id}.json`)), `${mod.id}: no baseline`);
		}
		for (const mod of mods) {
			for (const parent of mod.parents) {
				assert.ok(ids.has(parent) && parent !== mod.id, `${mod.id}: parent ${parent} is not a listed mod`);
			}
		}
	});

	it('names no listed mod in the extension or its workflows', () => {
		const files = ['src', 'webviewsrc', '.github']
			.flatMap(dir => filesUnder(path.join(repoRoot, dir)))
			.filter(file => path.resolve(file) !== path.resolve(repoRoot, 'src', 'test', 'compatmods.test.ts'));
		const found: string[] = [];
		for (const file of files) {
			const text = fs.readFileSync(file, 'utf8').toLowerCase();
			for (const mod of mods) {
				for (const needle of [mod.id, mod.repo]) {
					if (text.includes(needle.toLowerCase())) {
						found.push(`${path.relative(repoRoot, file)}: ${needle}`);
					}
				}
			}
		}
		assert.deepStrictEqual(found, []);
	});
});
