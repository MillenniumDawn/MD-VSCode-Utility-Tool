// Bumps package.json and seeds a matching CHANGELOG.md section.
//
// Used by .github/workflows/version-bump.yml when someone comments /bump on a pull request, and
// usable by hand:
//
//   node scripts/bump-version.js --type patch --title "Fix the thing" --number 42
//   node scripts/bump-version.js --type minor --title "..." --body-file pr-body.txt
//
// The seeded changelog bullet is a starting point taken from the pull request title. It carries no
// [ Component ] prefix on purpose -- guessing one wrong is worse than leaving it to the author.

'use strict';

const fs = require('fs');
const path = require('path');

const releaseTypes = ['patch', 'minor', 'major'];

function parseVersion(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
	if (!match) {
		throw new Error(`Not a plain three-part version: ${value}`);
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextVersion(current, releaseType = 'patch') {
	if (!releaseTypes.includes(releaseType)) {
		throw new Error(`Unknown release type "${releaseType}", expected one of ${releaseTypes.join(', ')}`);
	}
	const [major, minor, patch] = parseVersion(current);
	if (releaseType === 'major') {
		return `${major + 1}.0.0`;
	}
	if (releaseType === 'minor') {
		return `${major}.${minor + 1}.0`;
	}
	return `${major}.${minor}.${patch + 1}`;
}

// "Closes #12", "fixes #12", "resolve #12" -- the keywords GitHub itself accepts. The first match
// wins, which is the one the pull request body leads with.
function issueFromBody(body) {
	const match = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i.exec(String(body ?? ''));
	return match ? Number(match[1]) : undefined;
}

// One sentence, no trailing full stop duplicated, and no leading "[ Component ]" invented.
function bulletFor(title, issue) {
	let text = String(title ?? '').trim();
	if (!text) {
		text = 'Describe this change.';
	}
	if (!/[.!?]$/.test(text)) {
		text += '.';
	}
	return issue === undefined ? `- ${text}` : `- ${text} Issue #${issue}.`;
}

function changelogSection(version, title, issue) {
	return `v${version}\n\n  Functionality:\n\n${bulletFor(title, issue)}\n`;
}

function prependChangelog(existing, version, title, issue) {
	const section = changelogSection(version, title, issue);
	const rest = String(existing ?? '').replace(/^\s+/, '');
	return rest ? `${section}\n${rest}` : section;
}

function readVersion(packageJsonText) {
	const parsed = JSON.parse(packageJsonText);
	if (typeof parsed.version !== 'string') {
		throw new Error('package.json has no "version" string');
	}
	return parsed.version;
}

// Rewrites only the version literal so the file's own formatting (tabs, key order) survives intact.
function writeVersion(packageJsonText, version) {
	let replaced = false;
	const result = packageJsonText.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, (_all, before, after) => {
		replaced = true;
		return before + version + after;
	});
	if (!replaced) {
		throw new Error('Could not find the "version" field in package.json');
	}
	return result;
}

function applyBump(options = {}) {
	const root = options.cwd ?? process.cwd();
	const packageJsonPath = path.join(root, 'package.json');
	const changelogPath = path.join(root, 'CHANGELOG.md');

	const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
	const previous = readVersion(packageJsonText);
	const next = nextVersion(previous, options.releaseType ?? 'patch');

	const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
	const issue = options.issue ?? issueFromBody(options.body);

	fs.writeFileSync(packageJsonPath, writeVersion(packageJsonText, next));
	fs.writeFileSync(changelogPath, prependChangelog(changelogText, next, options.title, issue));

	return { previous, next, issue };
}

function parseArgs(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = argv[i + 1];
		switch (arg) {
			case '--type':
				options.releaseType = value;
				i++;
				break;
			case '--title':
				options.title = value;
				i++;
				break;
			case '--number':
				options.number = value;
				i++;
				break;
			case '--body':
				options.body = value;
				i++;
				break;
			case '--body-file':
				options.body = value && fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : '';
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
	const result = applyBump(options);
	// The workflow reads these two lines.
	process.stdout.write(`previous=${result.previous}\n`);
	process.stdout.write(`next=${result.next}\n`);
}

if (require.main === module) {
	main();
}

module.exports = {
	applyBump,
	bulletFor,
	changelogSection,
	issueFromBody,
	nextVersion,
	parseArgs,
	parseVersion,
	prependChangelog,
	readVersion,
	writeVersion,
};
