// Checks out a mod listed in compat/mods.json, and each of its parents, at the pinned commit, for
// the compat runner. Only the folders the entry names are checked out (never gfx/, which is most of
// a mod's size and nothing the runner reads), and blobs are fetched only for those folders.
//
// Run:   node scripts/compat-checkout.js <id> <destRoot>
// Prints the runner's arguments for the mod, one per line: `--mod <destRoot>/<id>`, then
// `--parent <destRoot>/<parent>` for each parent.
// A folder already holding the pinned commit is left as it is, so a restored cache costs nothing.
//
// The compat workflow calls this rather than naming a repository itself: compat/mods.json is the
// only place a real mod is named.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function readMods(file = path.join(repoRoot, 'compat', 'mods.json')) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The mod and every parent it needs, parents first, each once. */
function resolveOrder(mods, id, seen = new Set()) {
	const mod = mods.find(m => m.id === id);
	if (!mod) {
		throw new Error(`${id} is not listed in compat/mods.json`);
	}
	if (seen.has(id)) {
		return [];
	}
	seen.add(id);
	return [...(mod.parents ?? []).flatMap(parent => resolveOrder(mods, parent, seen)), mod];
}

function git(args, cwd) {
	return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

function headOf(dir) {
	try {
		return git(['rev-parse', 'HEAD'], dir);
	} catch {
		return undefined;
	}
}

function checkout(mod, dir, run = git) {
	if (fs.existsSync(dir) && headOf(dir) === mod.ref) {
		return false;
	}
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	run(['init', '--quiet'], dir);
	run(['remote', 'add', 'origin', `https://github.com/${mod.repo}.git`], dir);
	run(['sparse-checkout', 'set', ...mod.paths], dir);
	run(['fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', mod.ref], dir);
	run(['checkout', '--quiet', 'FETCH_HEAD'], dir);
	return true;
}

function runnerArgs(order, destRoot) {
	const mod = order[order.length - 1];
	return [
		'--mod', path.join(destRoot, mod.id),
		...order.slice(0, -1).flatMap(parent => ['--parent', path.join(destRoot, parent.id)]),
	];
}

function main(argv) {
	const [id, destRoot] = argv;
	if (!id || !destRoot) {
		console.error('Usage: node scripts/compat-checkout.js <id> <destRoot>');
		return 1;
	}
	const order = resolveOrder(readMods(), id);
	for (const mod of order) {
		const dir = path.join(path.resolve(destRoot), mod.id);
		console.error(`${mod.id}: ${checkout(mod, dir) ? 'checked out' : 'already at'} ${mod.ref}`);
	}
	console.log(runnerArgs(order, path.resolve(destRoot)).join('\n'));
	return 0;
}

if (require.main === module) {
	process.exitCode = main(process.argv.slice(2));
}

module.exports = { readMods, resolveOrder, checkout, runnerArgs };
