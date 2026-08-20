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
// The output is JSON: { bullets: ["- ...", ...], pullRequests: [108, 97] }.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const { bulletFor, issueFromBody } = require('./bump-version');

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function lines(output) {
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

// The pure half: a list of pull requests in merge order becomes the changelog bullets. A pull
// request listed twice (two commits, one pull request) contributes one bullet.
function bulletsFromPullRequests(pullRequests) {
	const seen = new Set();
	const bullets = [];
	const numbers = [];

	for (const pr of pullRequests ?? []) {
		const number = Number(pr?.number);
		if (!Number.isInteger(number) || seen.has(number)) {
			continue;
		}
		seen.add(number);
		numbers.push(number);
		bullets.push(bulletFor(pr.title, issueFromBody(pr.body)));
	}

	return { bullets, pullRequests: numbers };
}

function pullRequestsForCommit(repo, sha) {
	try {
		const output = execFileSync(
			'gh',
			['api', `repos/${repo}/commits/${sha}/pulls`, '-H', 'Accept: application/vnd.github+json'],
			{ encoding: 'utf8' });
		const parsed = JSON.parse(output);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		// An unauthenticated gh, a rate limit or a commit pushed straight to main all land here; the
		// caller falls back to the commit subject.
		return [];
	}
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
			found.push({ number: pr.number, title: pr.title, body: pr.body });
		}
	}

	// Newest first in git log, but a changelog reads better in the order things landed.
	found.reverse();
	const result = bulletsFromPullRequests(found);

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

module.exports = { bulletsFromPullRequests, collect, parseArgs };
