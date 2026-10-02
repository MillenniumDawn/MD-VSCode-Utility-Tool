// Rebuilds the release pull request's CHANGELOG.md from main's.
//
//   node scripts/merge-changelog.js --main main-changelog.md --previous-main previous-main-changelog.md \
//       --release release-changelog.md --version 1.1.24
//
// .github/workflows/release.yml runs this every time the release branch catches up with main,
// whether the merge conflicted or not. Main's Unreleased section is the changelog: it is taken as it
// stands and given the version heading. The release branch adds only the bullets main never had --
// the ones seeded from pull request titles, and whatever was fixed by hand on the release branch.
//
//   --main           main's CHANGELOG.md now
//   --previous-main  main's CHANGELOG.md when the release branch last caught up (the merge base)
//   --release        the release branch's CHANGELOG.md before this merge
//
// It used to keep the release branch's copy and add only what main said that the copy did not,
// which dropped main's bullets whenever the copy already had one for the same issue (Issue #498).

'use strict';

const fs = require('fs');
const path = require('path');

const { readVersion, rebuildChangelog, writeVersion } = require('./bump-version');
const { parseFlags } = require('./lib/flags');

function parseArgs(argv) {
	return parseFlags(argv, {
		'--main': 'main',
		'--previous-main': 'previousMain',
		'--release': 'release',
		'--version': 'version',
		'--cwd': 'cwd',
	}, { defaults: { main: '', previousMain: '', release: '', version: '' } });
}

function readIfThere(file) {
	return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function run(options) {
	const root = options.cwd ?? process.cwd();
	const changelogPath = path.join(root, 'CHANGELOG.md');
	const packageJsonPath = path.join(root, 'package.json');

	// The version the release goes out as was decided by higherVersion in the workflow; without one,
	// keep whatever package.json already says. Only package.json is written here: the changelog
	// heading comes out of the rebuild below.
	const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
	const version = options.version || readVersion(packageJsonText);
	if (readVersion(packageJsonText) !== version) {
		fs.writeFileSync(packageJsonPath, writeVersion(packageJsonText, version));
	}

	const current = readIfThere(changelogPath);
	const rebuilt = rebuildChangelog(
		readIfThere(options.main),
		readIfThere(options.release),
		readIfThere(options.previousMain),
		version);

	if (rebuilt !== current) {
		fs.writeFileSync(changelogPath, rebuilt);
	}

	return { version, changed: rebuilt !== current };
}

function main() {
	const result = run(parseArgs(process.argv.slice(2)));
	process.stdout.write(`version=${result.version}\nchanged=${result.changed}\n`);
}

if (require.main === module) {
	main();
}

module.exports = { parseArgs, run };
