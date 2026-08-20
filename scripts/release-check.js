// Decides what a push to main should do: publish, open a release pull request, or nothing.
//
//   node scripts/release-check.js            # from a push to main
//   node scripts/release-check.js --manual   # from a workflow_dispatch
//
// Both .github/workflows/release.yml and .github/workflows/version-bump.yml run this, so the two
// never disagree about whether a push is releasable. The answer is written to $GITHUB_OUTPUT as
// `tag`, `release` and `bump`, and the exit code is always 0 -- "nothing to release" is an answer,
// not a failure.
//
// The three outcomes:
//   release=true            the version in package.json has no tag yet, so publish it
//   bump=true               the tag is taken and the extension itself changed, so a release pull
//                           request has to carry the next version
//   release=false bump=false  only documentation and CI changed since the tag; nothing to ship

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { readVersion } = require('./bump-version');
const { isExempt } = require('./check-version');

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function tagExists(tag) {
	try {
		git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
		return true;
	} catch {
		return false;
	}
}

function changedSince(tag) {
	const output = git(['diff', '--name-only', `${tag}..HEAD`]);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

// The whole decision, with the git lookups already done, so it can be tested without a repository.
function decide(state) {
	const tag = state.tag;

	if (!state.tagExists) {
		return {
			tag,
			release: true,
			bump: false,
			notice: `Tag ${tag} does not exist yet, so this push is published.`,
		};
	}

	const shipped = (state.changedFiles ?? []).filter((file) => !isExempt(file));
	// A manual run is asking for a release, so it never takes the documentation exemption.
	if (!state.manual && shipped.length === 0) {
		return {
			tag,
			release: false,
			bump: false,
			notice:
				`Tag ${tag} already exists, and nothing outside documentation and CI changed since it, ` +
				'so there is nothing to release.',
		};
	}

	return {
		tag,
		release: false,
		bump: true,
		notice:
			`Tag ${tag} already exists while ${shipped.length} file(s) that ship in the extension changed ` +
			'since it, so a release pull request is needed.',
	};
}

function evaluate(options = {}) {
	const root = options.cwd ?? process.cwd();
	const version = readVersion(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const tag = `v${version}`;
	const exists = tagExists(tag);

	return decide({
		tag,
		tagExists: exists,
		manual: options.manual === true,
		changedFiles: exists ? changedSince(tag) : [],
	});
}

function report(result) {
	process.stdout.write(`::notice::${result.notice}\n`);

	const outputPath = process.env.GITHUB_OUTPUT;
	if (outputPath) {
		fs.appendFileSync(
			outputPath,
			`tag=${result.tag}\nrelease=${result.release}\nbump=${result.bump}\n`);
	}

	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		fs.appendFileSync(summaryPath, `### Release check\n\n${result.notice}\n`);
	}
}

function parseArgs(argv) {
	const options = { manual: false };
	for (const arg of argv) {
		if (arg === '--manual') {
			options.manual = true;
		}
	}
	return options;
}

function main() {
	report(evaluate(parseArgs(process.argv.slice(2))));
}

if (require.main === module) {
	main();
}

module.exports = { decide, evaluate, parseArgs };
