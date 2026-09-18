// Publishes a built .vsix to the VS Code Marketplace or to Open VSX, and tries again when the
// registry is the problem rather than the extension.
//
//   node scripts/publish-extension.js --registry marketplace --vsix <file>                 # release
//   node scripts/publish-extension.js --registry marketplace --vsix <file> --pre-release   # pre-release
//   node scripts/publish-extension.js --registry open-vsx --vsix <file>
//   node scripts/publish-extension.js --registry open-vsx --vsix <file> --schedule patient
//
// VSCE_PAT carries the Marketplace token and OPEN_VSX_TOKEN the Open VSX one. The publish itself
// is vsce's or ovsx's, run from the dev dependencies.
//
// A release of this extension once failed on nothing but `Request timeout: /_apis/gallery` -- the
// Marketplace took too long to answer, the job went red, and a fix pull request was opened for a
// build that had nothing wrong with it. Another failed the same way on Open VSX answering
// `503: Service Unavailable` to the single request the publish action made. So a failure that
// reads like the network or the registry being unwell is retried, and a failure that reads like
// anything else (a rejected token, a bad manifest) is not, because it would only fail again.
//
// Two schedules. `quick` is for the first go: three attempts with half a minute and a minute
// between them, which covers a hiccup. `patient` is for the retry job that runs after the quick
// one gave up: it waits five, ten and fifteen minutes before each of its attempts, because a
// registry that has just said 503 is not helped by being asked again at once. When even the
// last attempt fails on something transient, `transient=true` is written to GITHUB_OUTPUT, which
// is how the workflow tells "the registry is down" from "the token is wrong" and decides whether
// the patient retry is worth running. Both registries have that retry job: v1.1.37 failed on the
// Marketplace answering 503 to all three quick attempts while only Open VSX had one.
//
// Every attempt passes --skip-duplicate. That is what makes the retry safe: a publish the registry
// accepted before timing out on the answer is found to be there on the next attempt and counted as
// done, instead of failing on the version already existing. It is also what lets the release
// workflow publish a version a second time -- from a re-run of the failed job, or from the merge
// of the fix pull request -- without the registry that already has it turning that into an error.

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

// `before` is the pause, in seconds, taken before each attempt; a zero is no pause.
const schedules = {
	quick: { before: [0, 30, 60] },
	patient: { before: [300, 600, 900] },
};

const registries = {
	marketplace: {
		label: 'VS Code Marketplace',
		tokenVariable: 'VSCE_PAT',
		missingToken: [
			'VSCE_PAT is not set, so nothing can reach the VS Code Marketplace. Create a',
			'personal access token with Marketplace: Manage scope at',
			'https://dev.azure.com and add it as the repository secret VSCE_PAT.',
		],
		command(options) {
			const args = ['--no-install', '@vscode/vsce', 'publish', '--packagePath', options.vsix, '--skip-duplicate'];
			if (options.preRelease) {
				args.push('--pre-release');
			}
			args.push('--pat', options.pat);
			return args;
		},
	},
	'open-vsx': {
		label: 'Open VSX',
		tokenVariable: 'OPEN_VSX_TOKEN',
		missingToken: [
			'OPEN_VSX_TOKEN is not set, so nothing can reach Open VSX. Create an access',
			'token at https://open-vsx.org/user-settings/tokens and add it as the',
			'repository secret OPEN_VSX_TOKEN. The publisher namespace has to exist',
			'first: npx ovsx create-namespace MilleniumDawnModTeam -p <token>.',
		],
		// No --pre-release: ovsx answers "Ignoring option '--pre-release' for prepackaged extension"
		// and reads the flag out of the manifest instead, where `vsce package --pre-release` put it.
		command(options) {
			return ['--no-install', 'ovsx', 'publish', options.vsix, '--skip-duplicate', '-p', options.pat];
		},
	},
};

// Whether the registry's output describes a failure that could pass on its own. A 5xx only counts
// by its reason phrase, in parentheses the way vsce writes it (`Failed Request: Bad Gateway(502)`),
// or after "status" the way ovsx writes it (`status 503: Service Unavailable`): the version in the
// .vsix name is three bare numbers too, and a pre-release patch is the run number, which will
// pass 500.
const transientPatterns = [
	/request timeout/i,
	/\bETIMEDOUT\b/,
	/\bECONNRESET\b/,
	/\bECONNREFUSED\b/,
	/\bEAI_AGAIN\b/,
	/socket hang up/i,
	/Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out/i,
	/\(5\d\d\)/,
	/\bstatus(?: code)?[:=]? *5\d\d\b/i,
];

function isTransient(output) {
	const text = String(output ?? '');
	return transientPatterns.some((pattern) => pattern.test(text));
}

function sleep(seconds) {
	// Synchronous on purpose: this script does one thing, and the workflow step waits on it anyway.
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

// The argv npx gets for one attempt. Kept apart from the spawn so a test can read it.
function commandFor(options) {
	return registries[options.registry].command(options);
}

function publishOnce(options) {
	// The output is both shown as it happens and kept, because the retry decision reads it.
	const result = spawnSync('npx', commandFor(options), { encoding: 'utf8', shell: process.platform === 'win32' });
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	process.stdout.write(output);
	if (result.error) {
		process.stdout.write(`${result.error.message}\n`);
	}
	return { ok: result.status === 0, output: result.error ? `${output}${result.error.message}` : output };
}

// Tells the workflow the last failure was one the registry may recover from. Nothing is written
// for a permanent one, so a missing output reads as "do not bother trying later".
function reportTransient() {
	if (process.env.GITHUB_OUTPUT) {
		fs.appendFileSync(process.env.GITHUB_OUTPUT, 'transient=true\n');
	}
}

function publish(options, deps = { publishOnce, sleep, reportTransient }) {
	const { label } = registries[options.registry];
	const pauses = schedules[options.schedule].before;
	for (let attempt = 1; attempt <= pauses.length; attempt++) {
		const pause = pauses[attempt - 1];
		if (pause > 0) {
			process.stdout.write(`Attempt ${attempt} of ${pauses.length} on ${label} in ${pause}s.\n`);
			deps.sleep(pause);
		}
		const result = deps.publishOnce(options);
		if (result.ok) {
			return true;
		}
		if (!isTransient(result.output)) {
			return false;
		}
		if (attempt === pauses.length) {
			process.stdout.write(`::warning::Every attempt on ${label} failed on what looks like a registry or network hiccup.\n`);
			deps.reportTransient();
			return false;
		}
		process.stdout.write(`::warning::Attempt ${attempt} of ${pauses.length} on ${label} failed on what looks like a registry or network hiccup; trying again.\n`);
	}
	return false;
}

function parseArgs(argv) {
	const options = { registry: '', vsix: '', preRelease: false, schedule: 'quick', pat: '' };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--registry':
				options.registry = value ?? '';
				i++;
				break;
			case '--vsix':
				options.vsix = value ?? '';
				i++;
				break;
			case '--schedule':
				options.schedule = value ?? '';
				i++;
				break;
			case '--pre-release':
				options.preRelease = true;
				break;
			default:
				break;
		}
	}
	const registry = registries[options.registry];
	if (registry) {
		options.pat = process.env[registry.tokenVariable] ?? '';
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const registry = registries[options.registry];
	if (!registry) {
		process.stderr.write(`::error::--registry must be one of ${Object.keys(registries).join(', ')}.\n`);
		process.exit(2);
	}
	if (!schedules[options.schedule]) {
		process.stderr.write(`::error::--schedule must be one of ${Object.keys(schedules).join(', ')}.\n`);
		process.exit(2);
	}
	if (!options.vsix) {
		process.stderr.write('::error::--vsix <file> is required.\n');
		process.exit(2);
	}
	if (!options.pat) {
		for (const line of registry.missingToken) {
			process.stderr.write(`::error::${line}\n`);
		}
		process.exit(1);
	}
	process.exit(publish(options) ? 0 : 1);
}

if (require.main === module) {
	main();
}

module.exports = { commandFor, isTransient, parseArgs, publish, registries, schedules };
