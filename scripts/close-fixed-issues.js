// Closes open bug reports carrying the `outdated version` label (applied elsewhere, see #149) once
// the changelog shows the reported problem has since been fixed.
//
//   node scripts/close-fixed-issues.js
//   node scripts/close-fixed-issues.js --dry-run
//
// .github/workflows/close-fixed-issues.yml runs this weekly and on every published release. For
// each candidate issue it reads the "Extension version" field the bug report template asks for,
// collects every CHANGELOG.md section shipped after that version, and asks a model whether the
// report is among them. Only a confident "fixed" naming one of those versions closes anything --
// "not fixed" and "unsure" both leave the issue untouched, and so does any error along the way. A
// false close is worse than a stale issue, so every failure path does nothing rather than guess.
//
// No OPENROUTER_API_KEY means no issue is ever looked at; the run is a no-op and exits 0.

'use strict';

const fs = require('fs');
const path = require('path');

const { compareVersions, headingPattern, sectionAt } = require('./bump-version');
const { warn, notice } = require('./lib/actions-log');
const { parseFlags } = require('./lib/flags');
const { gh } = require('./lib/github');
const { createBudget, messageContent, post, request, withRateLimitRetry } = require('./lib/openrouter');

const title = 'MD VSCode Utility Tool outdated-issue check';
const maxBodyLength = 4000;
const maxChangesLength = 20000;
const maxClosuresPerRun = 3;
const outdatedVersionLabel = 'outdated version';
const marker = '<!-- close-fixed-issues -->';

const style = [
	'You judge whether a bug report filed against a Visual Studio Code extension has already been fixed.',
	'You are given the report and the changelog entries for every version shipped since the one it was filed against.',
	'Decide whether the reported problem is described as fixed among those entries.',
	'Reply "fixed" only when you are confident one of the entries describes fixing exactly this problem, and give the version number from that entry\'s own heading.',
	'Reply "not fixed" when none of the entries address it, or when you are not confident an entry that does is exactly this problem.',
	'Reply "unsure" only when the report itself is too unclear to judge either way.',
	'Never guess a version that is not one of the headings you were given.',
	'Keep the reasoning to one sentence.',
].join('\n');

const versionFieldPattern = /###\s*Extension version\s*\n+([^\n]+)/i;

// The bug report template (.github/ISSUE_TEMPLATE/bug-report.yml) renders its "Extension version"
// field as a "### Extension version" heading followed by whatever was typed in, so the version is
// pulled out of the issue body rather than tracked anywhere else.
function extractReportedVersion(body) {
	const field = versionFieldPattern.exec(String(body ?? ''));
	if (!field) {
		return undefined;
	}
	const version = /(\d+\.\d+\.\d+)/.exec(field[1]);
	return version ? version[1] : undefined;
}

// CHANGELOG.md split into its shipped version sections, newest first.
function allSections(changelogText) {
	const lines = String(changelogText ?? '').split(/\r?\n/);
	const sections = [];
	for (let i = 0; i < lines.length; i++) {
		if (!headingPattern.test(lines[i].trim())) {
			continue;
		}
		const section = sectionAt(lines, i);
		if (!section.unreleased) {
			sections.push({
				version: section.version,
				text: lines.slice(section.start, section.end).join('\n').trim(),
			});
		}
		i = section.end - 1;
	}
	return sections;
}

// What shipped after the version an issue was filed against, oldest first so the model reads it as
// the story of what changed since. Truncated defensively -- an issue filed many releases ago could
// otherwise carry the whole changelog into the prompt.
function changelogSince(changelogText, sinceVersion) {
	const since = /^\d+\.\d+\.\d+$/.test(String(sinceVersion ?? '').trim()) ? sinceVersion.trim() : undefined;
	const matched = since
		? allSections(changelogText).filter((section) => compareVersions(section.version, since) > 0)
		: [];
	matched.reverse();

	let text = matched.map((section) => section.text).join('\n\n');
	if (text.length > maxChangesLength) {
		text = `${text.slice(0, maxChangesLength)}\n...(truncated)`;
	}

	return { versions: matched.map((section) => section.version), text };
}

function describeIssue(entry) {
	const lines = [`Issue #${entry.number}`, `Title: ${entry.title}`, `Reported on version ${entry.reportedVersion}`];
	const body = String(entry.body ?? '').replace(/\r/g, '').trim();
	if (body) {
		lines.push('Report:', body.slice(0, maxBodyLength));
	}
	lines.push('', `Changelog entries shipped after v${entry.reportedVersion}:`, entry.changesText || '(none)');
	return lines.join('\n');
}

// Any reply that is not a clean "fixed"/"not fixed"/"unsure" with a one-sentence reason is treated
// as "not fixed" -- a non-answer never closes anything, but it is also not the same as the model
// having looked and found nothing, so it is logged as its own case.
function parseVerdict(content) {
	const raw = String(content ?? '').trim();
	const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(raw);
	let parsed;
	try {
		parsed = JSON.parse(fenced ? fenced[1] : raw);
	} catch {
		return { verdict: 'not fixed', version: '', reasoning: 'The model reply was not valid JSON.' };
	}

	const verdict = ['fixed', 'not fixed', 'unsure'].includes(parsed?.verdict) ? parsed.verdict : 'not fixed';
	const version = typeof parsed?.version === 'string' ? parsed.version.trim() : '';
	const reasoning = typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
		? parsed.reasoning.trim()
		: 'The model gave no reasoning.';
	return { verdict, version, reasoning };
}

// Closes only on a "fixed" verdict that names one of the versions the model was actually shown --
// a version it invents is treated the same as no version at all.
function decideAction(verdict, availableVersions) {
	if (verdict.verdict !== 'fixed' || !(availableVersions ?? []).includes(verdict.version)) {
		return { close: false };
	}
	return { close: true, version: verdict.version };
}

function commentFor(version) {
	return `${marker}\nThis looks fixed as of v${version}, based on the changelog. Update to the latest `
		+ 'version and this should be resolved -- if it still happens there, reopen with details.';
}

function hasLabel(labels, wanted) {
	return (labels ?? []).some((label) => String(label?.name ?? label ?? '').toLowerCase() === wanted);
}

// A comment this workflow already left means either it closed the issue before and a human
// reopened it, or it is mid-run twice over. Either way it is never touched again: never reopen, and
// never re-close something a human reopened.
function alreadyHandled(comments) {
	return (comments ?? []).some((comment) => String(comment?.body ?? '').includes(marker));
}

async function judge(entry, key, budget = createBudget()) {
	const payload = await withRateLimitRetry(() => post('/chat/completions', request(
		[
			{ role: 'system', content: style },
			{ role: 'user', content: describeIssue(entry) },
		],
		500,
		{
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'fix_verdict',
					strict: true,
					schema: {
						type: 'object',
						properties: {
							verdict: { type: 'string', enum: ['fixed', 'not fixed', 'unsure'] },
							version: { type: 'string' },
							reasoning: { type: 'string' },
						},
						required: ['verdict', 'version', 'reasoning'],
						additionalProperties: false,
					},
				},
			},
		}), key, { budget, title }), budget);

	return parseVerdict(messageContent(payload));
}

function listOpenIssueNumbers(repo) {
	try {
		const parsed = JSON.parse(gh([
			'issue', 'list', '--repo', repo, '--label', outdatedVersionLabel, '--state', 'open',
			'--json', 'number', '--limit', '200',
		]));
		return Array.isArray(parsed) ? parsed.map((issue) => issue.number).filter(Number.isInteger) : [];
	} catch (error) {
		warn(`Could not list issues labelled "${outdatedVersionLabel}" (${error?.message ?? error}).`);
		return [];
	}
}

function issueDetails(repo, number) {
	try {
		return JSON.parse(gh([
			'issue', 'view', String(number), '--repo', repo,
			'--json', 'number,title,body,comments,labels,state',
		]));
	} catch (error) {
		warn(`Issue #${number}: could not read it (${error?.message ?? error}); skipping.`);
		return undefined;
	}
}

function closeIssue(repo, number, comment) {
	gh(['issue', 'close', String(number), '--repo', repo, '--comment', comment]);
}

async function run(options) {
	const key = process.env.OPENROUTER_API_KEY?.trim() ?? '';
	if (!key) {
		notice('No OPENROUTER_API_KEY is set, so no outdated-version issue is checked.');
		return;
	}

	const repo = process.env.GITHUB_REPOSITORY ?? '';
	if (!repo) {
		warn('No GITHUB_REPOSITORY is set; cannot list issues.');
		return;
	}

	const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
	const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';

	const budget = createBudget(options.budgetMs);
	let closed = 0;
	for (const number of listOpenIssueNumbers(repo)) {
		if (budget.signal.aborted || budget.remaining() <= 0) {
			notice('The outdated-issue check used up its model budget; remaining issues stay open.');
			break;
		}
		if (closed >= maxClosuresPerRun) {
			notice(`Reached the cap of ${maxClosuresPerRun} closures for this run; the rest wait for next time.`);
			break;
		}

		const issue = issueDetails(repo, number);
		if (!issue || issue.state !== 'OPEN' || !hasLabel(issue.labels, outdatedVersionLabel)) {
			continue;
		}
		if (alreadyHandled(issue.comments)) {
			continue;
		}

		const reportedVersion = extractReportedVersion(issue.body);
		if (!reportedVersion) {
			warn(`Issue #${number}: could not read the extension version it was filed against; skipping.`);
			continue;
		}

		const changes = changelogSince(changelogText, reportedVersion);
		if (changes.versions.length === 0) {
			notice(`Issue #${number}: nothing has shipped since v${reportedVersion} yet.`);
			continue;
		}

		let verdict;
		try {
			verdict = await judge(
				{ number, title: issue.title, body: issue.body, reportedVersion, changesText: changes.text }, key, budget);
		} catch (error) {
			warn(`Issue #${number}: could not reach the model (${error?.message ?? error}); leaving it open.`);
			continue;
		}

		notice(`Issue #${number}: ${verdict.verdict}${verdict.version ? ` (v${verdict.version})` : ''} -- ${verdict.reasoning}`);

		const action = decideAction(verdict, changes.versions);
		if (!action.close) {
			continue;
		}

		if (options.dryRun) {
			notice(`Issue #${number}: would close as fixed by v${action.version} (--dry-run, not closing).`);
			continue;
		}

		closeIssue(repo, number, commentFor(action.version));
		notice(`Issue #${number}: closed as fixed by v${action.version}.`);
		closed++;
	}
}

function parseArgs(argv) {
	return parseFlags(argv, { '--dry-run': { name: 'dryRun', value: true } }, { defaults: { dryRun: false } });
}

async function main() {
	await run(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
	main().catch((error) => {
		warn(`The outdated-issue check failed outright (${error?.message ?? error}); no issue was touched.`);
	});
}

module.exports = {
	alreadyHandled,
	allSections,
	changelogSince,
	commentFor,
	decideAction,
	describeIssue,
	extractReportedVersion,
	hasLabel,
	judge,
	marker,
	outdatedVersionLabel,
	parseArgs,
	parseVerdict,
	run,
};
