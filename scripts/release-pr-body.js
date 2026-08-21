// Writes the body of the release pull request.
//
//   node scripts/release-pr-body.js --version 1.1.24 --bullets-file bullets.json --output body.md
//   node scripts/release-pr-body.js --version 1.1.24 --bullets-file bullets.json \
//       --existing current-body.md --output body.md
//
// .github/workflows/version-bump.yml uses this for both paths -- opening the pull request and
// refreshing an open one -- so the two cannot drift apart.
//
// On a refresh only the block between the two markers is rewritten. Anything typed into the body by
// hand survives, which matters because this pull request stays open for a run of merges and is the
// natural place to write a release note.

'use strict';

const fs = require('fs');

const openMarker = '<!-- release-pr:prs -->';
const closeMarker = '<!-- /release-pr:prs -->';
const heading = '### Pull requests in this release';
const coveredPrefix = 'Included pull requests: ';

// "#109" autolinks on GitHub, so every entry is one click from here to the pull request it came
// from -- which is the question anyone reading a release pull request asks first.
function pullRequestList(entries) {
	const listed = (entries ?? [])
		.map((entry) => {
			const number = Number(entry?.number);
			if (!Number.isInteger(number)) {
				return undefined;
			}
			const title = String(entry?.title ?? '').trim().replace(/\s+/g, ' ');
			return title ? `- #${number} ${title}` : `- #${number}`;
		})
		.filter(Boolean);

	return [openMarker, ...(listed.length > 0 ? listed : ['- None yet.']), closeMarker].join('\n');
}

function intro(version, hasBumpToken) {
	const lines = [
		'**This pull request stays open and updates itself.** Every merge into `main` adds its changes here, '
			+ 'so a run of merges becomes one release instead of one release each. Nothing is published until you merge this.',
		'',
		`Merging it publishes \`v${version}\`.`,
		'',
		'The bullets in `CHANGELOG.md` are written for you: the `[ Component ]` prefix comes from the files each '
			+ 'pull request touched, the Functionality and Bugfixes split from its labels, and the wording from the '
			+ 'release model. Read them before you merge and edit anything that reads wrong -- a later refresh only '
			+ 'adds bullets for pull requests not already listed below, so an edit of yours is never overwritten.',
		'',
	];

	if (!hasBumpToken) {
		lines.push(
			'No `BUMP_TOKEN` secret is set, so a push to this branch starts no run by itself. The test workflow '
				+ 'is started against the branch instead, on every refresh, and its result is on the commit -- '
				+ 'read it before you merge. Only the advisory version check is missing.',
			'');
	}

	// The list ends every entry with its own blank line, and the heading that follows needs one more
	// in front of it or Markdown runs the two together.
	return `${lines.join('\n')}\n`;
}

// The machine-readable half. The refresh step reads this line back to know which pull requests it
// has already written a bullet for, so it has to survive every rewrite.
function trailer(entries) {
	const numbers = (entries ?? []).map((entry) => Number(entry?.number)).filter(Number.isInteger);
	return `<!-- release-pr -->\n${coveredPrefix}${numbers.join(',')}\n`;
}

function render(options) {
	const { version, entries, hasBumpToken, existing } = options;
	const list = pullRequestList(entries);

	if (!existing) {
		return `${intro(version, hasBumpToken)}${heading}\n\n${list}\n\n${trailer(entries)}`;
	}

	let body = String(existing);

	// The version this pull request would publish moves whenever a branch bumps past it, and the
	// title moves with it. This one line has to follow, or the body claims a version the release no
	// longer carries. Everything else in the intro is left alone, because it may have been edited.
	if (version) {
		body = body.replace(/^Merging it publishes `v\d+\.\d+\.\d+`\.$/m, `Merging it publishes \`v${version}\`.`);
	}

	// Replace the list in place when it is there, and add it above the trailer when a body predates
	// this section or someone deleted it.
	if (body.includes(openMarker) && body.includes(closeMarker)) {
		const from = body.indexOf(openMarker);
		const to = body.indexOf(closeMarker) + closeMarker.length;
		body = body.slice(0, from) + list + body.slice(to);
	} else {
		const marker = body.indexOf('<!-- release-pr -->');
		const insert = `${heading}\n\n${list}\n\n`;
		body = marker === -1 ? `${body.trimEnd()}\n\n${insert}` : body.slice(0, marker) + insert + body.slice(marker);
	}

	if (body.includes('<!-- release-pr -->')) {
		body = body.replace(new RegExp(`^${coveredPrefix}.*$`, 'm'), trailer(entries).split('\n')[1]);
	} else {
		body = `${body.trimEnd()}\n\n${trailer(entries)}`;
	}

	return body.endsWith('\n') ? body : `${body}\n`;
}

function readEntries(file) {
	if (!file || !fs.existsSync(file)) {
		return [];
	}
	const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
	return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

function parseArgs(argv) {
	const options = { version: '', file: '', existing: '', output: '', hasBumpToken: process.env.HAS_BUMP_TOKEN === 'true' };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--version':
				options.version = value;
				i++;
				break;
			case '--bullets-file':
				options.file = value;
				i++;
				break;
			case '--existing':
				options.existing = value;
				i++;
				break;
			case '--output':
				options.output = value;
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
	const body = render({
		version: options.version,
		entries: readEntries(options.file),
		hasBumpToken: options.hasBumpToken,
		existing: options.existing && fs.existsSync(options.existing)
			? fs.readFileSync(options.existing, 'utf8')
			: '',
	});

	if (options.output) {
		fs.writeFileSync(options.output, body);
	} else {
		process.stdout.write(body);
	}
}

if (require.main === module) {
	main();
}

module.exports = { closeMarker, coveredPrefix, openMarker, parseArgs, pullRequestList, render, trailer };
