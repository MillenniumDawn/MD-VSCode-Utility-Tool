#!/usr/bin/env node
// Stop-hook: dwingt af dat elke turn met bronwijzigingen ook een patch
// versie-bump (package.json) en een CHANGELOG.md-entry bevat.
// Fail-open: bij elke onverwachte fout wordt het stoppen toegestaan.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readStdin() {
	try {
		return fs.readFileSync(0, 'utf8');
	} catch {
		return '';
	}
}

function git(args) {
	return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function versionAt(ref) {
	try {
		const raw = ref === null
			? fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
			: git(`show ${ref}:package.json`);
		return JSON.parse(raw).version;
	} catch {
		return null;
	}
}

function allow() {
	process.exit(0);
}

function block(reason) {
	process.stdout.write(JSON.stringify({ decision: 'block', reason }));
	process.exit(0);
}

function main() {
	let input = {};
	try {
		input = JSON.parse(readStdin() || '{}');
	} catch {
		input = {};
	}

	let changed;
	try {
		// Tracked wijzigingen t.o.v. HEAD + untracked bestanden.
		const tracked = git('diff --name-only HEAD');
		const untracked = git('ls-files --others --exclude-standard');
		changed = (tracked + '\n' + untracked)
			.split('\n')
			.map(s => s.trim())
			.filter(Boolean);
	} catch {
		// Geen git / geen HEAD / andere fout -> niet blokkeren.
		return allow();
	}

	const norm = f => f.replace(/\\/g, '/').toLowerCase();
	const changedNorm = changed.map(norm);

	// Meta-/tooling-bestanden tellen niet als extensie-functionaliteit en horen
	// dus niet in de gebruikersgerichte changelog.
	const isIgnored = f =>
		f === 'changelog.md' ||
		f === 'package.json' ||
		f === 'claude.md' ||
		f.startsWith('.claude/');

	const codeChanged = changedNorm.some(f => !isIgnored(f));
	if (!codeChanged) {
		return allow();
	}

	const changelogUpdated = changedNorm.includes('changelog.md');
	const versionBumped = (() => {
		const head = versionAt('HEAD');
		const disk = versionAt(null);
		return head !== null && disk !== null && head !== disk;
	})();

	if (versionBumped && changelogUpdated) {
		return allow();
	}

	// Loop-veiligheid: als de hook al actief was en de conditie nog steeds niet
	// is opgelost, blijven we vragen (de conditie wordt vanzelf onwaar zodra
	// Claude bumpt + changelog schrijft). Dit is informatief.
	const stopActive = input.stop_hook_active === true;

	const current = versionAt(null) || '1.1.2';
	const parts = String(current).split('.');
	if (parts.length === 3 && /^\d+$/.test(parts[2])) {
		parts[2] = String(parseInt(parts[2], 10) + 1);
	}
	const next = parts.join('.');

	const missing = [];
	if (!versionBumped) missing.push('package.json "version" is niet opgehoogd');
	if (!changelogUpdated) missing.push('CHANGELOG.md is niet bijgewerkt');

	const reason =
		`Er zijn bronwijzigingen in de working tree, maar ${missing.join(' en ')}.\n\n` +
		`Werk dit bij voordat je de turn afrondt:\n` +
		`1. Bump in package.json het "version"-veld met +1 patch (van ${current} naar ${next}).\n` +
		`2. Voeg bovenaan CHANGELOG.md een nieuwe sectie "v${next}" toe in de bestaande stijl ` +
		`(subsecties "Functionality:" en/of "Bugfixes:" met "  - " bullets en een ` +
		`[ Component ]-prefix), die de wijzigingen van deze turn inhoudelijk beschrijft.\n` +
		`Houd package.json en de CHANGELOG-kop op exact dezelfde versie.` +
		(stopActive ? '\n\n(Deze melding herhaalt zich tot beide bijgewerkt zijn.)' : '');

	return block(reason);
}

try {
	main();
} catch {
	allow();
}
