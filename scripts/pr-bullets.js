// Collects the changelog bullets for a release: one per pull request merged since the last tag.
//
//   node scripts/pr-bullets.js --tag v1.1.23 --output bullets.json
//
// .github/workflows/version-bump.yml runs this to seed the release pull request. Every commit on
// main since the tag is asked which pull request it came from, so a squash merge ("Title (#108)")
// and a merge commit ("Merge pull request #97 from ...") both resolve to the real pull request --
// parsing the subject line would only handle one of the two. A commit that belongs to no pull
// request falls back to its own subject.
//
// The output is JSON: { bullets, pullRequests, entries }, where bullets[i] belongs to
// pullRequests[i] and entries[i] carries what the rest of the release needs to know about it --
// its title, the "[ Component ]" prefix its files earned and the subsection its labels put it in.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const { bulletFor, issueFromBody } = require('./bump-version');
const { componentForFiles, sectionForPullRequest } = require('./changelog-bullets');

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function lines(output) {
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

// The pure half: a list of pull requests in merge order becomes the changelog bullets. A pull
// request listed twice (two commits, one pull request) contributes one bullet.
//
// The prefix comes from the files the pull request touched and the subsection from its labels, so
// both are decided here rather than being left to whoever merges the release pull request.
function bulletsFromPullRequests(pullRequests) {
	const seen = new Set();
	const bullets = [];
	const numbers = [];
	const entries = [];

	for (const pr of pullRequests ?? []) {
		const number = Number(pr?.number);
		if (!Number.isInteger(number) || seen.has(number)) {
			continue;
		}
		seen.add(number);
		numbers.push(number);

		const issue = issueFromBody(pr.body);
		const component = componentForFiles(pr.files);
		const section = sectionForPullRequest(pr);
		bullets.push(withComponent(bulletFor(pr.title, issue), component));
		entries.push({ number, title: String(pr.title ?? '').trim(), body: pr.body ?? '', component, section, issue });
	}

	return { bullets, pullRequests: numbers, entries };
}

// "- Title." becomes "- [ Focus Tree ] Title." A bullet that already carries a prefix keeps it.
function withComponent(bullet, component) {
	const text = String(bullet ?? '');
	if (!component || /^-\s*\[/.test(text)) {
		return text;
	}
	return text.replace(/^-\s*/, `- [ ${component} ] `);
}

function api(path, args = []) {
	try {
		const output = execFileSync(
			'gh',
			['api', path, '-H', 'Accept: application/vnd.github+json', ...args],
			{ encoding: 'utf8' });
		return JSON.parse(output);
	} catch {
		// An unauthenticated gh, a rate limit or a commit pushed straight to main all land here; every
		// caller has something sensible to do with nothing.
		return undefined;
	}
}

function pullRequestsForCommit(repo, sha) {
	const parsed = api(`repos/${repo}/commits/${sha}/pulls`);
	return Array.isArray(parsed) ? parsed : [];
}

// The paths a pull request touched, for the "[ Component ]" prefix. Capped at one page: a pull
// request with more than a hundred files has no single component anyway, and the majority rule in
// componentForFiles reads a sample the same way it reads the whole.
function filesForPullRequest(repo, number) {
	const parsed = api(`repos/${repo}/pulls/${number}/files`, ['--paginate', '-X', 'GET', '-f', 'per_page=100']);
	return Array.isArray(parsed) ? parsed.map((file) => file?.filename).filter(Boolean) : [];
}

// The labels on the issue this pull request closes, so a fix filed under an issue labelled `bug`
// lands in Bugfixes even when the pull request itself was never labelled.
function issueLabels(repo, issue) {
	if (!issue) {
		return [];
	}
	const parsed = api(`repos/${repo}/issues/${issue}`);
	return Array.isArray(parsed?.labels) ? parsed.labels : [];
}

// Everything bulletsFromPullRequests needs that the commits endpoint does not already return.
function enrich(repo, pullRequest) {
	if (!repo || !pullRequest) {
		return pullRequest;
	}
	return {
		...pullRequest,
		files: filesForPullRequest(repo, pullRequest.number),
		issueLabels: issueLabels(repo, issueFromBody(pullRequest.body)),
	};
}

function collect(options) {
	const range = `${options.tag}..HEAD`;
	// --first-parent: the merges themselves, not every commit that came along inside them.
	const commits = lines(git(['log', range, '--first-parent', '--pretty=%H']));

	const found = [];
	const withoutPullRequest = [];
	for (const sha of commits) {
		const prs = options.repo ? pullRequestsForCommit(options.repo, sha) : [];
		if (prs.length === 0) {
			withoutPullRequest.push(sha);
			continue;
		}
		for (const pr of prs) {
			found.push({ number: pr.number, title: pr.title, body: pr.body, labels: pr.labels });
		}
	}

	// Newest first in git log, but a changelog reads better in the order things landed.
	found.reverse();
	// Enrichment costs two more requests per pull request, so drop the repeats first --
	// --first-parent lists the same pull request twice when two of its commits landed separately,
	// and bulletsFromPullRequests would only discard the second one afterwards.
	const seen = new Set();
	const once = found.filter((pr) => {
		if (seen.has(pr.number)) {
			return false;
		}
		seen.add(pr.number);
		return true;
	});
	const result = bulletsFromPullRequests(once.map((pr) => enrich(options.repo, pr)));

	for (const sha of withoutPullRequest.reverse()) {
		const subject = git(['log', '-1', '--pretty=%s', sha]);
		// A merge commit with no pull request behind it says nothing a reader wants.
		if (!/^Merge (pull request|branch|remote-tracking)/i.test(subject)) {
			result.bullets.push(bulletFor(subject));
		}
	}

	if (result.bullets.length === 0) {
		result.bullets.push(bulletFor(''));
	}

	return result;
}

function parseArgs(argv) {
	const options = { repo: process.env.GITHUB_REPOSITORY ?? '', output: '' };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--tag':
				options.tag = value;
				i++;
				break;
			case '--repo':
				options.repo = value;
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
	if (!options.tag) {
		throw new Error('Pass --tag <tag> to say where the release range starts');
	}

	const result = collect(options);
	const json = JSON.stringify(result, undefined, '\t');
	if (options.output) {
		fs.writeFileSync(options.output, `${json}\n`);
	}
	process.stdout.write(`${json}\n`);
}

if (require.main === module) {
	main();
}

module.exports = {
	bulletsFromPullRequests,
	collect,
	filesForPullRequest,
	issueLabels,
	parseArgs,
	pullRequestsForCommit,
	withComponent,
};
