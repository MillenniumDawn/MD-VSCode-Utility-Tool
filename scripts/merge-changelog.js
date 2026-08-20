// Resolves a CHANGELOG.md conflict between the release pull request and main.
//
//   node scripts/merge-changelog.js --theirs main-changelog.md --version 1.1.24
//
// .github/workflows/version-bump.yml runs this after `git merge origin/main` conflicts on the
// release branch. The release pull request's changelog wins, because it may have been reworded by
// hand; main contributes only the bullets ours does not already say, under the same subsection
// heading it had there.
//
// The conflict this handles is a branch that wrote its own changelog section on main while the
// release pull request was open. Combining the two is the whole point -- aborting the merge and
// asking for it to be resolved by hand is what this replaces.

'use strict';

const fs = require('fs');
const path = require('path');

const { combineChangelogs, readVersion, setVersion } = require('./bump-version');

function parseArgs(argv) {
	const options = { theirs: '', version: '' };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--theirs':
				options.theirs = value;
				i++;
				break;
			case '--version':
				options.version = value;
				i++;
				break;
			case '--cwd':
				options.cwd = value;
				i++;
				break;
			default:
				break;
		}
	}
	return options;
}

function run(options) {
	const root = options.cwd ?? process.cwd();
	const changelogPath = path.join(root, 'CHANGELOG.md');

	// The version the release goes out as was decided by higherVersion in the workflow; without one,
	// keep whatever package.json already says.
	const version = options.version || readVersion(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	setVersion({ cwd: root, version });

	const ours = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
	const theirs = options.theirs && fs.existsSync(options.theirs) ? fs.readFileSync(options.theirs, 'utf8') : '';
	const combined = combineChangelogs(ours, theirs, version);

	if (combined !== ours) {
		fs.writeFileSync(changelogPath, combined);
	}

	return { version, changed: combined !== ours };
}

function main() {
	const result = run(parseArgs(process.argv.slice(2)));
	process.stdout.write(`version=${result.version}\nchanged=${result.changed}\n`);
}

if (require.main === module) {
	main();
}

module.exports = { parseArgs, run };
