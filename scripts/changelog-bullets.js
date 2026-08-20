// Turns what a pull request touched into the two things a changelog bullet needs before anyone
// reads it: the "[ Component ]" prefix and whether it belongs under Functionality or Bugfixes.
// Also holds the union used when the release pull request's changelog conflicts with main's.
//
// Everything here is pure -- no git, no network, no filesystem -- so scripts/pr-bullets.js and
// .github/workflows/version-bump.yml can call it and src/test/versionscripts.test.ts can test it
// without a repository.

'use strict';

// The scripts that exist only to run a release. scripts/geni18n.js and the rest are tooling for the
// extension itself and are deliberately not here.
const releaseScripts = new Set([
	'scripts/bump-version.js',
	'scripts/changelog-bullets.js',
	'scripts/check-version.js',
	'scripts/merge-changelog.js',
	'scripts/pr-bullets.js',
	'scripts/release-check.js',
	'scripts/release-pr-body.js',
	'scripts/rewrite-bullets.js',
	'scripts/select-bullets.js',
]);

// A change that says nothing about which part of the extension moved. These do not count towards a
// component and do not count against one either: a pull request is not less about the focus tree
// for having updated the changelog on the way.
function ignored(file) {
	return /^[^/]+\.md$/.test(file)
		|| file === 'LICENSE'
		|| file === '.gitignore'
		|| file === 'package-lock.json';
}

// A preview owns every file whose path names it, wherever that file lives -- the loader under
// src/previewdef/event/, the webview entry point at webviewsrc/eventtree.ts and the stylesheet at
// resource/eventtree.css are all the event tree. Matching a whole path segment rather than a
// substring keeps src/test/eventcontentbuilder.test.ts out of it, which is a test first.
const componentTokens = new Map([
	['Focus Tree', ['focustree']],
	['Event Tree', ['event', 'eventtree']],
	['Technology', ['technology', 'techtree']],
	['MIO', ['mio', 'miopreview']],
	['World Map', ['worldmap']],
	['GFX', ['gfx']],
	['GUI', ['gui', 'guipreview']],
	['Decision', ['decision', 'decisiontree']],
]);

function segments(file) {
	return file.split('/').map((part) => part.replace(/\.[^.]+$/, '').toLowerCase());
}

// Ordered, first rule wins. The labels are the vocabulary CHANGELOG.md already uses, so a generated
// bullet is indistinguishable from a hand-written one; inventing a new label would show.
//
// A path that matches nothing contributes to no label on purpose. src/util/ and src/hoiformat/ are
// shared by every preview, so a change there says nothing about which component the reader cares
// about, and a wrong prefix is worse than none -- the same reasoning behind seeding bullets without
// one at all in scripts/bump-version.js.
const componentRules = [
	// .claude/ is repository tooling in the same sense .github/ is: it changes how the project is
	// built and released, never what the extension does.
	{ label: 'CI', test: (file) => file.startsWith('.github/') || file.startsWith('.claude/') || releaseScripts.has(file) },
	{
		label: 'Localisation',
		test: (file) => file.startsWith('i18n/')
			|| /^package\.nls(\.[\w-]+)?\.json$/.test(file)
			|| file === 'scripts/geni18n.js'
			|| file === 'scripts/genzhi18n.js',
	},
	{
		label: 'Build',
		test: (file) => file === 'package.json'
			|| file === 'eslint.config.cjs'
			|| file === '.vscodeignore'
			|| /^webpack\./.test(file)
			|| /^tsconfig(\.\w+)?\.json$/.test(file),
	},
	{ label: 'Testing', test: (file) => file.startsWith('src/test/') },
	{ label: 'Settings', test: (file) => file.startsWith('src/util/installpath') || file.startsWith('src/constants') },
	...[...componentTokens].map(([label, tokens]) => ({
		label,
		test: (file) => segments(file).some((part) => tokens.includes(part)),
	})),
	{ label: 'Previewer', test: (file) => file.startsWith('src/previewdef/') },
];

function labelFor(file) {
	return componentRules.find((rule) => rule.test(file))?.label;
}

// A pull request that spreads evenly over several components has no single honest prefix. Requiring
// a majority means "five focus tree files and one shared helper" is prefixed while "three previews
// at once" is not.
//
// Test files are set aside as soon as anything else is recognised, because a test that accompanies a
// change is about whatever the change was about -- counting it as Testing would make a well-tested
// focus tree fix look like a testing pull request. A pull request that touches nothing but tests
// still gets Testing, since then that is exactly what it is.
function componentForFiles(files) {
	const paths = (files ?? [])
		.map((file) => String(file ?? '').replace(/^\.\//, ''))
		.filter((file) => file && !ignored(file));
	if (paths.length === 0) {
		return undefined;
	}

	const labelled = paths.map((file) => ({ file, label: labelFor(file) }));
	const pool = labelled.some((entry) => entry.label && entry.label !== 'Testing')
		? labelled.filter((entry) => entry.label !== 'Testing')
		: labelled;

	const counts = new Map();
	for (const { label } of pool) {
		if (label) {
			counts.set(label, (counts.get(label) ?? 0) + 1);
		}
	}

	let best;
	// Iterating the rules rather than the map keeps ties resolving in table order.
	for (const { label } of componentRules) {
		const count = counts.get(label) ?? 0;
		if (count > (best?.count ?? 0)) {
			best = { label, count };
		}
	}

	return best && best.count * 2 > pool.length ? best.label : undefined;
}

function hasLabel(labels, wanted) {
	return (labels ?? []).some((label) => String(label?.name ?? label ?? '').toLowerCase() === wanted);
}

// The two issue templates apply `bug` and `enhancement` already, so the split costs nothing to read.
// The pull request's own labels win over the issue's, because a pull request labelled by hand is
// someone saying which one this is.
function sectionForPullRequest(pullRequest) {
	const own = pullRequest?.labels;
	if (hasLabel(own, 'bug')) {
		return 'Bugfixes';
	}
	if (hasLabel(own, 'enhancement')) {
		return 'Functionality';
	}
	if (hasLabel(pullRequest?.issueLabels, 'bug')) {
		return 'Bugfixes';
	}
	return 'Functionality';
}

const issuePattern = /\bIssue #(\d+)\.?\s*$/i;

// What two bullets have to share to be the same change. The prefix and the issue trailer are
// stripped because one side may have been reworded and prefixed while the other is still a raw
// pull request title.
function bulletKey(bullet) {
	return String(bullet ?? '')
		.replace(/^-\s*/, '')
		.replace(/^\[\s*[^\]]*\]\s*/, '')
		.replace(issuePattern, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function issueOf(bullet) {
	const match = issuePattern.exec(String(bullet ?? ''));
	return match ? match[1] : undefined;
}

// Bullets from `theirs` that `ours` does not already say, in their original order.
//
// Three ways to be a duplicate, because the same change can be worded three ways by the time it
// gets here: the identical line, the same sentence under a different prefix or trailer, and the
// same issue number. The last one is what stops main's raw title reappearing next to the release
// pull request's reworded version of it.
function newBullets(ours, theirs) {
	const lines = new Set((ours ?? []).map((bullet) => String(bullet ?? '').trim()));
	const keys = new Set((ours ?? []).map(bulletKey).filter(Boolean));
	const issues = new Set((ours ?? []).map(issueOf).filter(Boolean));

	const fresh = [];
	for (const bullet of theirs ?? []) {
		const text = String(bullet ?? '').trim();
		const key = bulletKey(text);
		const issue = issueOf(text);
		if (!text || lines.has(text) || (key && keys.has(key)) || (issue && issues.has(issue))) {
			continue;
		}
		lines.add(text);
		if (key) {
			keys.add(key);
		}
		if (issue) {
			issues.add(issue);
		}
		fresh.push(text);
	}

	return fresh;
}

module.exports = {
	bulletKey,
	componentForFiles,
	componentRules,
	componentTokens,
	ignored,
	issueOf,
	labelFor,
	newBullets,
	releaseScripts,
	sectionForPullRequest,
};
