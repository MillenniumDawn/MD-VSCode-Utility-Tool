// Flags a bug report filed against an older extension version.
//
//   ISSUE_BODY=... CURRENT_VERSION=1.1.30 node scripts/issue-version-triage.js
//
// Used by .github/workflows/issue-version-triage.yml on `issues: opened`. Reads the
// "### Extension version" section the ext-version field in .github/ISSUE_TEMPLATE/bug-report.yml
// renders into the issue body, and compares it against CURRENT_VERSION (package.json on main).
//
// Anything that is not a plain reported version older than current -- no field, a malformed value
// ("latest", "v1.1.x", empty), the current version, a newer one, or a label already applied -- gets
// no comment and no label. Nothing here ever closes the issue.
//
// Exit code is always 0. The decision is written to $GITHUB_OUTPUT as `flag`, and the comment body
// for the workflow to post is written to issue-version-comment.md when flag is true.

'use strict';

const fs = require('fs');
const path = require('path');

const { compareVersions } = require('./bump-version');

const label = 'outdated version';
const versionPattern = /^\d+\.\d+\.\d+$/;

function extractField(body, heading) {
	const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
	const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
	if (start === -1) {
		return undefined;
	}

	const content = [];
	for (let i = start + 1; i < lines.length && !/^### /.test(lines[i]); i++) {
		content.push(lines[i]);
	}

	const value = content.join('\n').trim();
	return value.length > 0 ? value : undefined;
}

function extractVersion(body) {
	return extractField(body, 'Extension version');
}

function commentBody(reported, current) {
	return `You're on \`${reported}\`, and \`${current}\` is current. Please update and let us know if this still happens on the current version.`;
}

function evaluate(options = {}) {
	const reported = extractVersion(options.body);
	if (!reported) {
		return { action: 'none', reason: 'no version field' };
	}
	if (!versionPattern.test(reported)) {
		return { action: 'none', reason: 'malformed version' };
	}
	if ((options.labels ?? []).includes(label)) {
		return { action: 'none', reason: 'already labelled' };
	}

	const current = options.currentVersion;
	if (compareVersions(reported, current) >= 0) {
		return { action: 'none', reason: 'current or newer' };
	}

	return { action: 'flag', reported, current, comment: commentBody(reported, current) };
}

function report(result) {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (outputPath) {
		fs.appendFileSync(outputPath, `flag=${result.action === 'flag'}\n`);
	}

	if (result.action === 'flag') {
		fs.writeFileSync('issue-version-comment.md', result.comment);
		process.stdout.write(`::notice::Reported version ${result.reported} is older than ${result.current}.\n`);
	} else {
		process.stdout.write(`::notice::No action: ${result.reason}.\n`);
	}
}

function readCurrentVersion() {
	if (process.env.CURRENT_VERSION) {
		return process.env.CURRENT_VERSION;
	}
	const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
	return packageJson.version;
}

function main() {
	const labels = (process.env.ISSUE_LABELS ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);

	report(evaluate({
		body: process.env.ISSUE_BODY,
		currentVersion: readCurrentVersion(),
		labels,
	}));
}

if (require.main === module) {
	main();
}

module.exports = { commentBody, evaluate, extractField, extractVersion, label };
