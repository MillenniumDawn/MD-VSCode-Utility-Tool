// Narrows the bullets scripts/pr-bullets.js collected down to the ones that still need writing.
//
//   node scripts/select-bullets.js --bullets-file bullets.json --output fresh.json \
//       --skip 114 --covered 109,110
//
// .github/workflows/version-bump.yml drops two kinds of bullet before touching CHANGELOG.md:
//
//   --skip     the pull request that carried a hand-written version bump. It already wrote its own
//              changelog section on main, so seeding a second bullet from its title would repeat it.
//   --covered  every pull request the open release pull request has already written a bullet for,
//              read from its body. This is what stops a bullet reworded by hand from being rewritten
//              on the next merge.
//
// bullets[i], pullRequests[i] and entries[i] describe the same pull request, so all three are
// filtered together. Bullets past the end of pullRequests came from a commit with no pull request
// behind it, are covered by nothing, and are kept.

'use strict';

const fs = require('fs');

function select(found, options) {
	const skip = String(options.skip ?? '').trim();
	const covered = new Set(String(options.covered ?? '').split(',').map((value) => value.trim()).filter(Boolean));

	const bullets = Array.isArray(found?.bullets) ? found.bullets : [];
	const pullRequests = Array.isArray(found?.pullRequests) ? found.pullRequests : [];
	const entries = Array.isArray(found?.entries) ? found.entries : [];

	const keep = pullRequests
		.map((_, index) => index)
		.filter((index) => {
			const number = String(pullRequests[index]);
			return number !== skip && !covered.has(number);
		});

	return {
		bullets: keep.map((index) => bullets[index]).concat(bullets.slice(pullRequests.length)),
		pullRequests: keep.map((index) => pullRequests[index]),
		entries: keep.map((index) => entries[index]).filter(Boolean),
	};
}

function parseArgs(argv) {
	const options = { file: '', output: '', skip: '', covered: '' };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--bullets-file':
				options.file = value;
				i++;
				break;
			case '--output':
				options.output = value;
				i++;
				break;
			case '--skip':
				options.skip = value;
				i++;
				break;
			case '--covered':
				options.covered = value;
				i++;
				break;
			default:
				break;
		}
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const found = JSON.parse(fs.readFileSync(options.file, 'utf8'));
	const result = select(found, options);
	const json = `${JSON.stringify(result, undefined, '\t')}\n`;

	fs.writeFileSync(options.output || options.file, json);
	process.stdout.write(`kept=${result.pullRequests.length}\n`);
}

if (require.main === module) {
	main();
}

module.exports = { parseArgs, select };
