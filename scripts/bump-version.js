// Bumps package.json and seeds a matching CHANGELOG.md section.
//
// Used by .github/workflows/version-bump.yml when a push to main needs a release pull request, and
// usable by hand:
//
//   node scripts/bump-version.js --type patch --title "Fix the thing" --number 42
//   node scripts/bump-version.js --type minor --title "..." --body-file pr-body.txt
//   node scripts/bump-version.js --type patch --bullets-file bullets.json
//   node scripts/bump-version.js --append --bullets-file fresh.json
//   node scripts/bump-version.js --set-version 1.1.24
//
// The seeded changelog bullets are a starting point taken from the titles of the pull requests that
// are being released. They carry no [ Component ] prefix on purpose -- guessing one wrong is worse
// than leaving it to whoever merges the release pull request.

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

function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) {
			return left[i] < right[i] ? -1 : 1;
		}
	}
	return 0;
}

// Which of two versions a release should carry. Used when a branch bumped the version while a
// release pull request was already open: the release keeps the higher of the two rather than
// silently dropping one of them.
function higherVersion(a, b) {
	return compareVersions(a, b) >= 0 ? a : b;
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

// A bullet may arrive already formatted (from scripts/pr-bullets.js) or as a bare sentence.
function normalizeBullet(bullet) {
	const text = String(bullet ?? '').trim();
	if (!text) {
		return '';
	}
	return text.startsWith('-') ? text : bulletFor(text);
}

// One title plus issue number, or a ready-made list of bullets -- both end up as a list here.
function toBullets(titleOrBullets, issue) {
	if (Array.isArray(titleOrBullets)) {
		const bullets = titleOrBullets.map(normalizeBullet).filter(Boolean);
		return bullets.length > 0 ? bullets : [bulletFor('')];
	}
	return [bulletFor(titleOrBullets, issue)];
}

function changelogSection(version, titleOrBullets, issue) {
	return `v${version}\n\n  Functionality:\n\n${toBullets(titleOrBullets, issue).join('\n')}\n`;
}

function prependChangelog(existing, version, titleOrBullets, issue) {
	const section = changelogSection(version, titleOrBullets, issue);
	const rest = String(existing ?? '').replace(/^\s+/, '');
	return rest ? `${section}\n${rest}` : section;
}

const headingPattern = /^v\d+\.\d+\.\d+$/;

// Where the section at the top of the changelog starts and ends, or undefined when the file does
// not open with a version heading.
function topSection(lines) {
	const start = lines.findIndex((line) => line.trim());
	if (start === -1 || !headingPattern.test(lines[start].trim())) {
		return undefined;
	}

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (headingPattern.test(lines[i].trim())) {
			end = i;
			break;
		}
	}

	return { start, end, version: lines[start].trim().slice(1) };
}

// The bullets of the section at the top of a changelog. Used to carry the bullets a branch wrote
// on main over into the release pull request when the two changelogs conflict.
function topSectionBullets(changelogText) {
	const lines = String(changelogText ?? '').split(/\r?\n/);
	const section = topSection(lines);
	if (!section) {
		return [];
	}
	return lines
		.slice(section.start + 1, section.end)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('- '));
}

// Adds bullets to the section that is already at the top of the changelog, so a release pull
// request that has been reworded by hand survives a later refresh. Bullets that are already there
// word for word are skipped, and a changelog whose top section is a different version gets a new
// section instead.
function appendBullets(existing, version, bullets) {
	const requested = Array.isArray(bullets) ? bullets : [bullets];
	// Nothing new to say. Unlike a fresh section, an append has no reason to invent a placeholder.
	if (requested.filter((bullet) => String(bullet ?? '').trim()).length === 0) {
		return String(existing ?? '');
	}

	const wanted = toBullets(requested);
	const lines = String(existing ?? '').split(/\r?\n/);
	const top = topSection(lines);

	if (!top || top.version !== version) {
		return prependChangelog(existing, version, wanted);
	}

	const section = lines.slice(top.start, top.end);
	const missing = wanted.filter((bullet) => !section.some((line) => line.trim() === bullet));
	if (missing.length === 0) {
		return String(existing ?? '');
	}

	// Append below the last line that has content, so the trailing blank line before the next
	// section stays where it is.
	let last = section.length - 1;
	while (last >= 0 && !section[last].trim()) {
		last--;
	}
	section.splice(last + 1, 0, ...missing);

	return [...lines.slice(0, top.start), ...section, ...lines.slice(top.end)].join('\n');
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
	const entry = Array.isArray(options.bullets) && options.bullets.length > 0 ? options.bullets : options.title;

	fs.writeFileSync(packageJsonPath, writeVersion(packageJsonText, next));
	fs.writeFileSync(changelogPath, prependChangelog(changelogText, next, entry, issue));

	return { previous, next, issue };
}

// Puts the release pull request on a specific version instead of a computed one, and renames the
// changelog section it is collecting into so the two agree.
//
// This assumes the section at the top of CHANGELOG.md is the unreleased one -- which it is on
// release/version-bump, where the top section is exactly what the open release pull request is
// gathering. Do not point this at a changelog whose top section has already shipped.
function setVersion(options = {}) {
	const root = options.cwd ?? process.cwd();
	const packageJsonPath = path.join(root, 'package.json');
	const changelogPath = path.join(root, 'CHANGELOG.md');

	const version = parseVersion(options.version).join('.');
	const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
	const previous = readVersion(packageJsonText);

	if (previous !== version) {
		fs.writeFileSync(packageJsonPath, writeVersion(packageJsonText, version));
	}

	let renamed = false;
	if (fs.existsSync(changelogPath)) {
		const changelogText = fs.readFileSync(changelogPath, 'utf8');
		const lines = changelogText.split(/\r?\n/);
		const top = topSection(lines);
		if (top && top.version !== version) {
			lines[top.start] = `v${version}`;
			fs.writeFileSync(changelogPath, lines.join('\n'));
			renamed = true;
		}
	}

	return { previous, version, renamed, changed: renamed || previous !== version };
}

// Used when a release pull request is already open: the version stays where it is and only the new
// bullets are added to its section.
function appendToChangelog(options = {}) {
	const root = options.cwd ?? process.cwd();
	const changelogPath = path.join(root, 'CHANGELOG.md');
	const version = options.version ?? readVersion(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

	const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
	const updated = appendBullets(changelogText, version, options.bullets ?? []);
	fs.writeFileSync(changelogPath, updated);

	return { version, changed: updated !== changelogText };
}

// scripts/pr-bullets.js writes { bullets: [...] }; a bare array is accepted too.
function readBulletsFile(file) {
	if (!file || !fs.existsSync(file)) {
		return [];
	}
	const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
	const bullets = Array.isArray(parsed) ? parsed : parsed.bullets;
	return Array.isArray(bullets) ? bullets : [];
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
			case '--bullets-file':
				options.bullets = readBulletsFile(value);
				i++;
				break;
			case '--set-version':
				options.version = value;
				i++;
				break;
			case '--append':
				options.append = true;
				break;
			default:
				break;
		}
	}
	return options;
}

// The workflow redirects this straight into $GITHUB_OUTPUT, so every key is written once.
function main() {
	const options = parseArgs(process.argv.slice(2));
	let changed = false;

	if (options.version !== undefined) {
		const result = setVersion(options);
		process.stdout.write(`version=${result.version}\nrenamed=${result.renamed}\n`);
		changed = result.changed;
	}

	if (options.append) {
		const result = appendToChangelog(options);
		if (options.version === undefined) {
			process.stdout.write(`version=${result.version}\n`);
		}
		changed = changed || result.changed;
	}

	if (options.version !== undefined || options.append) {
		process.stdout.write(`changed=${changed}\n`);
		return;
	}

	const result = applyBump(options);
	process.stdout.write(`previous=${result.previous}\nnext=${result.next}\n`);
}

if (require.main === module) {
	main();
}

module.exports = {
	appendBullets,
	appendToChangelog,
	applyBump,
	bulletFor,
	changelogSection,
	compareVersions,
	higherVersion,
	issueFromBody,
	nextVersion,
	parseArgs,
	parseVersion,
	prependChangelog,
	readBulletsFile,
	readVersion,
	setVersion,
	topSectionBullets,
	writeVersion,
};
