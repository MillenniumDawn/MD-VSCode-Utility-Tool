// Writes the names-only manifest of the base game that the hardcoded-path test checks against.
//
// The extension names game files in its source: `interface/goals.gfx`, `common/national_focus`,
// `GFX_focus_link_up_down`. When one of those only exists in Millennium Dawn, the preview works
// for MD and goes quiet on the base game and on every other mod, and no test notices, because
// every fixture was written by hand. The manifest is what the base game actually ships: the
// relative path of every file and folder under the folders a preview reads, and the name of every
// sprite in `interface/**/*.gfx`. Names only, never content, so it can be committed.
//
// Run:   node scripts/vanilla-manifest.js "<HOI4 install>" [--out compat/vanilla-manifest.json.gz]
// Rerun after a game patch; compat/README.md says what to do with the diff.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const repoRoot = path.resolve(__dirname, '..');
const defaultOut = path.join(repoRoot, 'compat', 'vanilla-manifest.json.gz');

// The folders a preview or one of its indexes reads from the game.
const manifestRoots = ['common', 'events', 'interface', 'gfx', 'map', 'history', 'localisation'];

// Sprite declarations: `name = "GFX_x"` or `name = GFX_x`, inside any spriteType flavour.
const spriteNamePattern = /\bname\s*=\s*"?(GFX_[A-Za-z0-9_.-]+)"?/g;

function walk(root, relative, files, dirs) {
	let entries;
	try {
		entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const child = relative + '/' + entry.name;
		if (entry.isDirectory()) {
			dirs.push(child);
			walk(root, child, files, dirs);
		} else if (entry.isFile()) {
			files.push(child);
		}
	}
}

function readVersion(installDir) {
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(installDir, 'launcher-settings.json'), 'utf8'));
		return String(settings.rawVersion ?? settings.version ?? 'unknown');
	} catch {
		return 'unknown';
	}
}

function spritesOf(installDir, files) {
	const sprites = new Set();
	for (const file of files) {
		if (!file.startsWith('interface/') || !file.toLowerCase().endsWith('.gfx')) {
			continue;
		}
		const content = fs.readFileSync(path.join(installDir, file), 'latin1');
		for (const match of content.matchAll(spriteNamePattern)) {
			sprites.add(match[1]);
		}
	}
	return [...sprites].sort();
}

function buildManifest(installDir) {
	const files = [];
	const dirs = [];
	for (const root of manifestRoots) {
		if (fs.existsSync(path.join(installDir, root))) {
			dirs.push(root);
			walk(installDir, root, files, dirs);
		}
	}
	if (files.length === 0) {
		throw new Error(`No game files found under ${installDir}; pass the HOI4 install folder.`);
	}
	files.sort();
	dirs.sort();
	return { version: readVersion(installDir), files, dirs, sprites: spritesOf(installDir, files) };
}

function writeManifest(manifest, outFile) {
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, zlib.gzipSync(JSON.stringify(manifest), { level: 9 }));
}

function main(argv) {
	const outIndex = argv.indexOf('--out');
	const outFile = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : defaultOut;
	const installDir = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--out');
	if (!installDir) {
		console.error('Usage: node scripts/vanilla-manifest.js <HOI4 install> [--out <file>]');
		return 1;
	}
	const manifest = buildManifest(path.resolve(installDir));
	writeManifest(manifest, outFile);
	console.log(`Game ${manifest.version}: ${manifest.files.length} files, ${manifest.dirs.length} folders, `
		+ `${manifest.sprites.length} sprites -> ${path.relative(repoRoot, outFile)}`);
	return 0;
}

if (require.main === module) {
	process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildManifest, writeManifest, manifestRoots };
