// Decides what a push to main should do: publish, open a release pull request, or nothing.
//
//   node scripts/release-check.js            # from a push to main
//   node scripts/release-check.js --manual   # from a workflow_dispatch
//
// GITHUB_REPOSITORY and GITHUB_SHA say which commit to look at; --repo and --sha override them.
//
// Both .github/workflows/release.yml and .github/workflows/version-bump.yml run this, so the two
// never disagree about whether a push is releasable. The answer is written to $GITHUB_OUTPUT as
// `tag`, `lastTag`, `version`, `release`, `bump`, `adopt` and `adoptedFrom`, and the exit code is
// always 0 -- "nothing to release" is an answer, not a failure.
//
// Publishing is tied to the release pull request, not to the version number. A branch that bumps
// package.json on its own no longer ships the moment it is merged; the bump is carried into the
// open release pull request instead, so a run of merges becomes one release.
//
// The four outcomes:
//   release=true            an untagged version arrived from release/version-bump, so publish it.
//                           Also the merge of a fix/release-v<version> branch -- the one
//                           release.yml opens when publishing failed -- whatever the tag says:
//                           the version goes out again, and a target that already has it is
//                           left alone by the publish jobs.
//   adopt=true bump=true    an untagged version arrived from somewhere else -- a branch bumped by
//                           hand. The release pull request takes that version over instead of
//                           bumping past it, and publishing waits for that pull request.
//   bump=true               the tag is taken and the extension itself changed, so a release pull
//                           request has to carry the next version
//   release=false bump=false  only documentation and CI changed since the tag; nothing to ship

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { readVersion } = require('./bump-version');
const { isExempt } = require('./check-version');
const { pullRequestsForCommit } = require('./pr-bullets');

const releaseBranch = 'release/version-bump';
// The branch release.yml pushes when a release failed to publish. Its merge is a release too.
const fixBranch = /^fix\/release-v\d+\.\d+\.\d+$/;

function isFixBranch(ref) {
	return fixBranch.test(String(ref ?? ''));
}

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitSucceeds(args) {
	try {
		execFileSync('git', args, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

// Only the merge that brought the release branch in has it reachable from the commit but not from
// the commit's first parent. Reachability alone is not enough -- the branch stays reachable for
// every later push to main as well.
function mergedReleaseBranch(sha) {
	const tip = `refs/remotes/origin/${releaseBranch}`;
	if (!gitSucceeds(['rev-parse', '--verify', '--quiet', tip])) {
		return false;
	}
	return gitSucceeds(['merge-base', '--is-ancestor', tip, sha])
		&& !gitSucceeds(['merge-base', '--is-ancestor', tip, `${sha}^`]);
}

// The fix branch is deleted the moment its pull request merges, so unlike the release branch there
// is no remote ref left to test reachability against. The merge commit still names it.
function mergedFixBranch(sha) {
	let subject;
	try {
		subject = git(['log', '-1', '--pretty=%s', sha]);
	} catch {
		return false;
	}
	return /^Merge pull request #\d+ from [^/\s]+\/fix\/release-v\d+\.\d+\.\d+$/.test(subject);
}

// Which pull request this commit arrived on main with, and whether that was the release pull
// request or the fix pull request for a failed release.
//
// The pull request behind the commit is the reliable answer, because it survives a squash merge as
// well as a merge commit -- the same lookup scripts/pr-bullets.js uses to name the pull requests in
// the changelog. When it finds nothing (an unauthenticated gh, a rate limit) the shape of the
// history answers both halves on its own.
function pushSource(repo, sha) {
	const pullRequests = repo ? pullRequestsForCommit(repo, sha) : [];
	const fromReleaseBranch = pullRequests.some((pr) => pr?.head?.ref === releaseBranch);
	const fromFixBranch = pullRequests.some((pr) => isFixBranch(pr?.head?.ref));

	return {
		number: pullRequests[0]?.number ?? '',
		fromReleaseBranch: fromReleaseBranch || (pullRequests.length === 0 && mergedReleaseBranch(sha)),
		fromFixBranch: fromFixBranch || (pullRequests.length === 0 && mergedFixBranch(sha)),
	};
}

function tagExists(tag) {
	try {
		git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
		return true;
	} catch {
		return false;
	}
}

// The last version that actually shipped. It is the tag itself in the ordinary case, but when a
// branch bumped package.json by hand the tag for that version does not exist yet, and the changelog
// bullets still have to be collected from the release before it.
// Pre-release tags are excluded on purpose. They look like release tags -- v1.3.57-pre.1 matches
// v[0-9]* -- but one is written on every push to main, so taking one as the last release would cut
// the changelog down to whatever landed since that push.
function lastReleaseTag() {
	try {
		return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--exclude', '*-pre.*']);
	} catch {
		return '';
	}
}

function changedSince(tag) {
	const output = git(['diff', '--name-only', `${tag}..HEAD`]);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

// The whole decision, with the git lookups already done, so it can be tested without a repository.
function decide(state) {
	const tag = state.tag;
	const version = tag.replace(/^v/, '');

	// The fix for a failed publish is a release in itself, tag or no tag. Whoever fixed it either
	// left the version alone -- the same build goes out again, and a registry that already has it
	// says so and is skipped -- or bumped it, and then the new version has no tag yet anyway.
	if (state.fromFixBranch) {
		return {
			tag,
			version,
			release: true,
			bump: false,
			adopt: false,
			notice:
				`This push merged the fix pull request for a failed release, so ${tag} is published` +
				(state.tagExists ? ' again; a target that already has it is left alone.' : '.'),
		};
	}

	if (!state.tagExists) {
		// A manual run is someone asking for this version to go out now, whatever opened it.
		if (state.fromReleaseBranch || state.manual) {
			return {
				tag,
				version,
				release: true,
				bump: false,
				adopt: false,
				notice: `Tag ${tag} does not exist yet and this push came from the release pull request, so it is published.`,
			};
		}

		return {
			tag,
			version,
			release: false,
			bump: true,
			adopt: true,
			notice:
				`Tag ${tag} does not exist yet, but this push did not come from ${releaseBranch}, so a branch ` +
				`bumped the version itself. The release pull request takes ${version} over and publishes it.`,
		};
	}

	const shipped = (state.changedFiles ?? []).filter((file) => !isExempt(file));
	// A manual run is asking for a release, so it never takes the documentation exemption.
	if (!state.manual && shipped.length === 0) {
		return {
			tag,
			version,
			release: false,
			bump: false,
			adopt: false,
			notice:
				`Tag ${tag} already exists, and nothing outside documentation and CI changed since it, ` +
				'so there is nothing to release.',
		};
	}

	return {
		tag,
		version,
		release: false,
		bump: true,
		adopt: false,
		notice:
			`Tag ${tag} already exists while ${shipped.length} file(s) that ship in the extension changed ` +
			'since it, so a release pull request is needed.',
	};
}

function evaluate(options = {}) {
	const root = options.cwd ?? process.cwd();
	const version = readVersion(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const tag = `v${version}`;
	const exists = tagExists(tag);

	// Asked in every case, one API call per push: a tagged version still has to know whether this
	// push merged the fix branch for it.
	const source = pushSource(options.repo, options.sha);

	const result = decide({
		tag,
		tagExists: exists,
		manual: options.manual === true,
		fromReleaseBranch: source.fromReleaseBranch,
		fromFixBranch: source.fromFixBranch,
		changedFiles: exists ? changedSince(tag) : [],
	});

	return {
		...result,
		lastTag: exists ? tag : lastReleaseTag(),
		// The pull request that wrote the bump being adopted. Its changelog bullets are already on
		// main, so the release pull request must not seed a second one for it.
		adoptedFrom: result.adopt ? source.number : '',
	};
}

function report(result) {
	process.stdout.write(`::notice::${result.notice}\n`);

	const outputPath = process.env.GITHUB_OUTPUT;
	if (outputPath) {
		fs.appendFileSync(
			outputPath,
			`tag=${result.tag}\nlastTag=${result.lastTag ?? result.tag}\nversion=${result.version}\n` +
			`release=${result.release}\nbump=${result.bump}\nadopt=${result.adopt}\n` +
			`adoptedFrom=${result.adoptedFrom ?? ''}\n`);
	}

	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		fs.appendFileSync(summaryPath, `### Release check\n\n${result.notice}\n`);
	}
}

function parseArgs(argv) {
	const options = {
		manual: false,
		repo: process.env.GITHUB_REPOSITORY ?? '',
		sha: process.env.GITHUB_SHA || 'HEAD',
	};
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--manual':
				options.manual = true;
				break;
			case '--repo':
				options.repo = value;
				i++;
				break;
			case '--sha':
				options.sha = value;
				i++;
				break;
			default:
				break;
		}
	}
	return options;
}

function main() {
	report(evaluate(parseArgs(process.argv.slice(2))));
}

if (require.main === module) {
	main();
}

module.exports = { decide, evaluate, isFixBranch, lastReleaseTag, parseArgs, pushSource, releaseBranch };
