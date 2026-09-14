// Bumps package.json and seeds a matching CHANGELOG.md section.
//
// Used by .github/workflows/release.yml when a push to main needs a release pull request, and
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

const { newBullets } = require('./changelog-bullets');

const releaseTypes = ['patch', 'minor', 'major'];

// VS Code's channel convention: stable takes the even minors and the pre-release channel takes the
// odd minor directly above. This rounds an odd minor up to the even stable line it belongs to, so
// 1.1.x and 1.2.x both sit on the 1.2 line. scripts/prerelease-version.js derives its own version
// from the same function, which is what keeps the two lines from ever crossing.
function stableMinor(minor) {
	return minor % 2 === 0 ? minor : minor + 1;
}

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value) {
	const match = versionPattern.exec(String(value ?? '').trim());
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
	// The next even minor strictly above this one, so a minor release steps over the odd pre-release
	// line sitting directly above the current stable one: 1.1 -> 1.2, but 1.2 -> 1.4.
	if (releaseType === 'minor') {
		return `${major}.${stableMinor(minor + 1)}.0`;
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

// The subsection headings, in the order CHANGELOG.md writes them. A bullet is filed under one of
// these by scripts/changelog-bullets.js; anything unrecognised falls back to the first.
const sections = ['Functionality', 'Bugfixes'];
const sectionHeadingPattern = /^\s{2}(\w[\w ]*):\s*$/;

function sectionOf(bullet) {
	const name = typeof bullet === 'object' && bullet !== null ? bullet.section : undefined;
	return sections.includes(name) ? name : sections[0];
}

function textOf(bullet) {
	return typeof bullet === 'object' && bullet !== null ? bullet.text : bullet;
}

// A bullet may arrive already formatted (from scripts/pr-bullets.js), as a bare sentence, or as a
// { text, section } pair once it knows which subsection it belongs under.
function normalizeBullet(bullet) {
	const text = String(textOf(bullet) ?? '').trim();
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

// The same list, grouped by subsection and keeping each group's original order. An entry that is a
// plain string has no opinion and lands under Functionality.
function bySection(titleOrBullets, issue) {
	const grouped = new Map();
	const entries = Array.isArray(titleOrBullets) ? titleOrBullets : [titleOrBullets];

	entries.forEach((bullet, index) => {
		const text = Array.isArray(titleOrBullets)
			? normalizeBullet(bullet)
			: toBullets(titleOrBullets, issue)[index];
		if (!text) {
			return;
		}
		const name = sectionOf(bullet);
		grouped.set(name, [...(grouped.get(name) ?? []), text]);
	});

	return grouped;
}

function changelogSection(version, titleOrBullets, issue) {
	const grouped = bySection(titleOrBullets, issue);
	// An empty list still produces a section, the way it always has: a placeholder bullet under
	// Functionality is more useful than a heading-less version number.
	if (grouped.size === 0) {
		grouped.set(sections[0], toBullets(titleOrBullets, issue));
	}

	const body = sections
		.filter((name) => grouped.has(name))
		.map((name) => `  ${name}:\n\n${grouped.get(name).join('\n')}\n`)
		.join('\n');

	return `v${version}\n\n${body}`;
}

function prependChangelog(existing, version, titleOrBullets, issue) {
	const section = changelogSection(version, titleOrBullets, issue);
	const rest = String(existing ?? '').replace(/^\s+/, '');
	return rest ? `${section}\n${rest}` : section;
}

// The heading a branch writes its bullets under before anyone knows which version they will ship
// in. The release pull request renames it to that version and leaves a fresh empty one behind, so
// this heading is the only part of CHANGELOG.md a feature branch ever touches.
const unreleasedHeading = 'Unreleased';
const versionHeadingPattern = /^v\d+\.\d+\.\d+$/;
const headingPattern = new RegExp(`^(?:v\\d+\\.\\d+\\.\\d+|${unreleasedHeading})$`);

// Where the section starting at `from` ends: the next heading, or the end of the file.
function sectionEnd(lines, from) {
	for (let i = from + 1; i < lines.length; i++) {
		if (headingPattern.test(lines[i].trim())) {
			return i;
		}
	}
	return lines.length;
}

function sectionAt(lines, start) {
	const text = lines[start].trim();
	const unreleased = text === unreleasedHeading;
	return { start, end: sectionEnd(lines, start), unreleased, version: unreleased ? undefined : text.slice(1) };
}

// Where the section at the top of the changelog starts and ends, or undefined when the file does
// not open with a heading. The heading may be Unreleased, in which case `version` is undefined.
function topSection(lines) {
	const start = lines.findIndex((line) => line.trim());
	if (start === -1 || !headingPattern.test(lines[start].trim())) {
		return undefined;
	}

	return sectionAt(lines, start);
}

function hasBullets(lines, section) {
	return lines.slice(section.start + 1, section.end).some((line) => line.trim().startsWith('- '));
}

// The section a changelog is currently collecting into. That is the top one, unless the top one is
// an Unreleased heading with nothing under it yet -- then it is the version section below.
//
// One rule that answers correctly on both sides of a merge. On main the Unreleased section holds
// what branches have written and is the section being collected into; on release/version-bump it
// has already been promoted, so the empty Unreleased left behind is skipped and the version section
// under it is the one a refresh appends to.
function collectingSection(lines) {
	const top = topSection(lines);
	if (!top || !top.unreleased || hasBullets(lines, top)) {
		return top;
	}

	const next = lines.findIndex((line, index) => index >= top.end && line.trim());
	return next === -1 ? top : sectionAt(lines, next);
}

// Renames the Unreleased heading to a version and leaves a fresh empty one above it, which is how a
// release pull request takes over what the branches wrote. A changelog with no Unreleased section
// is returned untouched, so the caller can fall back to prepending a section of its own.
function promoteUnreleased(existing, version) {
	const lines = String(existing ?? '').split(/\r?\n/);
	const top = topSection(lines);
	if (!top || !top.unreleased) {
		return String(existing ?? '');
	}

	lines.splice(top.start, 1, unreleasedHeading, '', `v${version}`);
	return lines.join('\n');
}

// The bullets of the section a changelog is collecting into, each with the subsection heading it
// sits under. Used to carry the bullets a branch wrote on main over into the release pull request
// when the two changelogs conflict, without moving a bugfix into Functionality on the way.
function topSectionEntries(changelogText) {
	const lines = String(changelogText ?? '').split(/\r?\n/);
	const section = collectingSection(lines);
	if (!section) {
		return [];
	}

	const entries = [];
	let current = sections[0];
	for (const line of lines.slice(section.start + 1, section.end)) {
		const heading = sectionHeadingPattern.exec(line);
		if (heading) {
			current = sections.includes(heading[1]) ? heading[1] : sections[0];
			continue;
		}
		const text = line.trim();
		if (text.startsWith('- ')) {
			entries.push({ text, section: current });
		}
	}

	return entries;
}

function topSectionBullets(changelogText) {
	return topSectionEntries(changelogText).map((entry) => entry.text);
}

// The release pull request's changelog wins, and the other side contributes only what it does not
// already say. Called when a merge from main conflicts in CHANGELOG.md: ours may have been reworded
// by hand, so it is never rewritten, but a bullet main carries for a change ours has no line for
// would otherwise be lost.
function combineChangelogs(oursText, theirsText, version) {
	const ours = topSectionEntries(oursText);
	const theirs = topSectionEntries(theirsText);

	const fresh = new Set(newBullets(ours.map((entry) => entry.text), theirs.map((entry) => entry.text)));
	const missing = theirs.filter((entry) => fresh.has(entry.text));

	// The heading has to agree with the version the release is going out as before anything is
	// appended, or appendBullets sees a different version and starts a whole new section. An
	// Unreleased heading is promoted rather than overwritten, so the empty one it leaves behind is
	// still there for the branches that merge after this.
	const lines = String(oursText ?? '').split(/\r?\n/);
	const top = collectingSection(lines);
	if (top?.unreleased && version) {
		return appendBullets(promoteUnreleased(oursText, version), version, missing);
	}
	if (top && version && top.version !== version) {
		lines[top.start] = `v${version}`;
	}
	const renamed = lines.join('\n');

	return missing.length === 0 ? renamed : appendBullets(renamed, top ? version ?? top.version : version, missing);
}

// Where each "  Functionality:" / "  Bugfixes:" heading sits inside a section, and how far its
// bullets run. Used to file an appended bullet under the right heading instead of at the bottom.
function subsectionRanges(section) {
	const found = [];
	for (let i = 1; i < section.length; i++) {
		const match = sectionHeadingPattern.exec(section[i]);
		if (match) {
			found.push({ name: match[1], heading: i });
		}
	}
	found.forEach((entry, index) => {
		entry.end = index + 1 < found.length ? found[index + 1].heading : section.length;
	});
	return found;
}

// The last line with content in [from, to), or from - 1 when the range is empty.
function lastContent(section, from, to) {
	let last = to - 1;
	while (last >= from && !section[last].trim()) {
		last--;
	}
	return last;
}

// Puts bullets under their own subsection heading, creating it in file order when it is not there
// yet. A section that has bullets but no headings at all keeps that shape -- inventing headings in
// a changelog someone wrote by hand would be a bigger change than the caller asked for.
function insertBySection(section, grouped) {
	for (const name of sections) {
		const wanted = grouped.get(name);
		if (!wanted || wanted.length === 0) {
			continue;
		}

		const ranges = subsectionRanges(section);
		const existing = ranges.find((range) => range.name === name);
		if (existing) {
			section.splice(lastContent(section, existing.heading + 1, existing.end) + 1, 0, ...wanted);
			continue;
		}

		if (ranges.length === 0) {
			section.splice(lastContent(section, 1, section.length) + 1, 0, ...wanted);
			continue;
		}

		const order = sections.indexOf(name);
		const before = [...ranges].reverse().find((range) => sections.indexOf(range.name) < order);
		if (before) {
			const at = lastContent(section, before.heading + 1, before.end) + 1;
			section.splice(at, 0, '', `  ${name}:`, '', ...wanted);
			continue;
		}

		const after = ranges.find((range) => sections.indexOf(range.name) > order);
		section.splice(after ? after.heading : section.length, 0, `  ${name}:`, '', ...wanted, '');
	}
}

// Adds bullets to the section that is already at the top of the changelog, so a release pull
// request that has been reworded by hand survives a later refresh. Bullets that are already there
// word for word are skipped, and a changelog whose top section is a different version gets a new
// section instead.
function appendBullets(existing, version, bullets) {
	const requested = Array.isArray(bullets) ? bullets : [bullets];
	// Nothing new to say. Unlike a fresh section, an append has no reason to invent a placeholder.
	if (requested.filter((bullet) => String(textOf(bullet) ?? '').trim()).length === 0) {
		return String(existing ?? '');
	}

	const lines = String(existing ?? '').split(/\r?\n/);
	const top = collectingSection(lines);

	if (!top || top.version !== version) {
		return prependChangelog(existing, version, requested);
	}

	const section = lines.slice(top.start, top.end);
	// The same union the changelog merge uses, rather than a line-for-line comparison: a bullet a
	// branch wrote by hand under Unreleased and the bullet seeded from that pull request's title are
	// the same change worded twice, and share an "Issue #NN." trailer even when nothing else matches.
	const already = section.map((line) => line.trim()).filter((line) => line.startsWith('- '));
	const fresh = new Set(newBullets(already, requested.map(normalizeBullet).filter(Boolean)));

	const grouped = new Map();
	let missing = 0;
	for (const bullet of requested) {
		const text = normalizeBullet(bullet);
		if (!text || !fresh.has(text)) {
			continue;
		}
		fresh.delete(text);
		const name = sectionOf(bullet);
		grouped.set(name, [...(grouped.get(name) ?? []), text]);
		missing++;
	}

	if (missing === 0) {
		return String(existing ?? '');
	}

	insertBySection(section, grouped);

	return [...lines.slice(0, top.start), ...section, ...lines.slice(top.end)].join('\n');
}

// Every consumer of this value goes on to interpolate it into a shell command, a `node -p`
// expression or a $GITHUB_OUTPUT line, so the shape is checked here rather than at each of them.
// The raw string is tested, without trimming: whitespace and newlines are exactly what an injected
// version carries, so they are refused rather than quietly normalised away.
function readVersion(packageJsonText) {
	const parsed = JSON.parse(packageJsonText);
	if (typeof parsed.version !== 'string') {
		throw new Error('package.json has no "version" string');
	}
	if (!versionPattern.test(parsed.version)) {
		throw new Error(`Not a plain three-part version: ${JSON.stringify(parsed.version)}`);
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
	fs.writeFileSync(changelogPath, bumpedChangelog(changelogText, next, entry, issue));

	return { previous, next, issue };
}

// What the changelog looks like once the version has moved. The bullets branches wrote under
// Unreleased are what is shipping, so that heading becomes the version and the seeded bullets are
// folded in beside them; a changelog with no Unreleased section still gets a section prepended, so
// nothing about the older shape breaks.
function bumpedChangelog(changelogText, version, titleOrBullets, issue) {
	const promoted = promoteUnreleased(changelogText, version);
	if (promoted === changelogText) {
		return prependChangelog(changelogText, version, titleOrBullets, issue);
	}
	// A promoted section already says what shipped, so an empty seed adds nothing to it -- unlike a
	// fresh section, which would rather carry a placeholder than stand there with no bullet at all.
	const seeded = Array.isArray(titleOrBullets)
		? titleOrBullets
		: (String(titleOrBullets ?? '').trim() ? [bulletFor(titleOrBullets, issue)] : []);
	return appendBullets(promoted, version, seeded);
}

// Puts the release pull request on a specific version instead of a computed one, and renames the
// changelog section it is collecting into so the two agree.
//
// The section it renames is the one being collected into -- the top one, or the version section
// under an Unreleased heading that has already been promoted. Do not point this at a changelog
// whose collecting section has already shipped.
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
		const top = collectingSection(lines);
		if (top && !top.unreleased && top.version !== version) {
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
	collectingSection,
	combineChangelogs,
	compareVersions,
	higherVersion,
	issueFromBody,
	nextVersion,
	parseArgs,
	parseVersion,
	prependChangelog,
	promoteUnreleased,
	readBulletsFile,
	readVersion,
	sections,
	setVersion,
	stableMinor,
	topSectionBullets,
	topSectionEntries,
	unreleasedHeading,
	versionHeadingPattern,
	writeVersion,
};
