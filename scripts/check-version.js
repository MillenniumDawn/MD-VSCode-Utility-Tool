// Reports whether a pull request that touched the version got it right.
//
//   node scripts/check-version.js --base-ref origin/main
//
// This is advisory only. A branch does not have to bump anything -- that is the normal way to work,
// and it passes without a word. Once the branch is merged, .github/workflows/version-bump.yml opens
// a release pull request that carries the bump and a seeded CHANGELOG.md section. The note this
// writes is there for the branch that wanted to ship the bump itself and got it half right: a
// version that already shipped, a version below the base, or a CHANGELOG heading that disagrees.
//
// Exit code 0 means nothing to say; 1 means there is a note, written to stdout, to
// $GITHUB_STEP_SUMMARY, to $GITHUB_OUTPUT as `failed`, and to version-check-message.md. The
// workflow never fails the job on it.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { compareVersions, nextVersion, readVersion } = require('./bump-version');

// Paths that cannot change what the packaged extension does, so a change touching only these does
// not need a version bump. scripts/release-check.js reads this same list to decide whether a push
// to main deserves a release pull request, so the two can never drift apart.
const exemptPatterns = [
	/\.md$/i,
	/^\.github\//,
	/^\.claude\//,
	/^LICENSE$/,
	/^\.gitignore$/,
	/^\.vscodeignore$/,
];

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function isExempt(file) {
	return exemptPatterns.some((pattern) => pattern.test(file));
}

function firstHeading(changelogText) {
	for (const line of String(changelogText ?? '').split(/\r?\n/)) {
		if (line.trim()) {
			return line.trim();
		}
	}
	return '';
}

function changedFiles(baseRef) {
	// Three-dot: what this branch added on top of the merge base, not whatever main moved on to.
	const output = git(['diff', '--name-only', `${baseRef}...HEAD`]);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function tagExists(tag) {
	try {
		// --quiet keeps a missing tag from writing "Needed a single revision" to stderr; a miss is an
		// expected answer here, not a failure.
		git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
		return true;
	} catch {
		return false;
	}
}

function baseVersion(baseRef) {
	return readVersion(git(['show', `${baseRef}:package.json`]));
}

// Every note ends the same way, because nothing here has to be fixed before merging.
function fixHint(expected) {
	return [
		'',
		'**This does not block the merge.** Once this lands on `main`, a release pull request with the ',
		'version bump and a seeded `CHANGELOG.md` section is opened for you, and it stays open and ',
		'collects every later merge until you merge it.',
		'',
		'To carry the bump in this pull request instead:',
		'',
		'```',
		'npm version patch --no-git-tag-version',
		'```',
		'',
		`and add a \`v${expected}\` section at the top of CHANGELOG.md. That still publishes through the `,
		'release pull request, which takes the version over rather than bumping past it.',
	].join('\n');
}

function evaluate(options) {
	const baseRef = options.baseRef;
	const files = changedFiles(baseRef);

	if (files.length > 0 && files.every(isExempt)) {
		return {
			ok: true,
			notice: `Only documentation and CI files changed (${files.length} file(s)), so no version bump is required.`,
		};
	}

	const base = baseVersion(baseRef);
	const head = readVersion(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
	const expected = nextVersion(base, 'patch');

	const order = compareVersions(head, base);

	// Leaving the version alone is the normal way to work, so it is not worth a note on every
	// pull request. The release pull request opened after the merge carries the bump.
	if (order === 0) {
		return {
			ok: true,
			notice:
				`Version ${head} is untouched, which is the normal way to work. A release pull request ` +
				`taking it to ${expected} is opened after the merge.`,
		};
	}

	if (order < 0) {
		return {
			ok: false,
			title: 'This pull request lowers the version',
			message:
				`\`package.json\` is at **${head}**, below the **${base}** on \`${baseRef}\`, so the release ` +
				'would go backwards.\n' +
				`\nLeave the version alone, or take it to **${expected}**.\n` +
				fixHint(expected),
		};
	}

	if (tagExists(`v${head}`)) {
		return {
			ok: false,
			title: `Version ${head} was already released`,
			message:
				`\`package.json\` is at **${head}**, but tag \`v${head}\` already exists, so the release workflow ` +
				`will refuse this version too.\n` +
				`\nPick a version above **${base}** that has not been tagged yet — **${expected}** if that is free.\n` +
				fixHint(expected),
		};
	}

	const heading = firstHeading(fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8'));
	if (heading !== `v${head}`) {
		return {
			ok: false,
			title: 'CHANGELOG.md does not match package.json',
			message:
				`\`package.json\` is at **${head}**, but the top section of \`CHANGELOG.md\` reads ` +
				`\`${heading || '(empty)'}\`.\n` +
				`\nAdd a \`v${head}\` section at the top describing what changed for users of the extension.\n` +
				fixHint(head),
		};
	}

	return { ok: true, notice: `Version ${base} -> ${head}, with a matching CHANGELOG section.` };
}

function report(result) {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	const outputPath = process.env.GITHUB_OUTPUT;

	if (result.ok) {
		process.stdout.write(`::notice::${result.notice}\n`);
		if (summaryPath) {
			fs.appendFileSync(summaryPath, `### Version check passed\n\n${result.notice}\n`);
		}
		if (outputPath) {
			fs.appendFileSync(outputPath, 'failed=false\n');
		}
		return 0;
	}

	const body = `### ${result.title}\n\n${result.message}\n`;
	process.stdout.write(`::warning::${result.title}. The merge is not blocked by this.\n`);
	process.stdout.write(body);
	if (summaryPath) {
		fs.appendFileSync(summaryPath, body);
	}
	if (outputPath) {
		fs.appendFileSync(outputPath, 'failed=true\n');
	}
	fs.writeFileSync('version-check-message.md', body);
	return 1;
}

function parseArgs(argv) {
	const options = { baseRef: 'origin/main' };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base-ref' && argv[i + 1]) {
			options.baseRef = argv[i + 1];
			i++;
		}
	}
	return options;
}

function main() {
	let result;
	try {
		result = evaluate(parseArgs(process.argv.slice(2)));
	} catch (error) {
		result = {
			ok: false,
			title: 'The version check could not run',
			message: `${error instanceof Error ? error.message : String(error)}`,
		};
	}
	process.exit(report(result));
}

if (require.main === module) {
	main();
}

module.exports = { compareVersions, evaluate, exemptPatterns, firstHeading, isExempt, parseArgs };
