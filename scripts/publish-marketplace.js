// Publishes a built .vsix to the VS Code Marketplace, and tries again when the Marketplace is the
// problem rather than the extension.
//
//   node scripts/publish-marketplace.js --vsix <file>                 # release channel
//   node scripts/publish-marketplace.js --vsix <file> --pre-release   # pre-release channel
//
// VSCE_PAT carries the token. The publish itself is vsce's, run from the dev dependencies.
//
// A release of this extension once failed on nothing but `Request timeout: /_apis/gallery` -- the
// Marketplace took too long to answer, the job went red, and a fix pull request was opened for a
// build that had nothing wrong with it. So a failure that reads like the network or the gallery
// being unwell is retried, a few times with a pause between, and a failure that reads like
// anything else (a rejected token, a bad manifest) is not, because it would only fail again.
//
// Every attempt passes --skip-duplicate. That is what makes the retry safe: a publish the gallery
// accepted before timing out on the answer is found to be there on the next attempt and counted as
// done, instead of failing on the version already existing. It is also what lets the release
// workflow publish a version a second time -- from a re-run of the failed job, or from the merge
// of the fix pull request -- without the registry that already has it turning that into an error.

'use strict';

const { spawnSync } = require('child_process');

const attempts = 3;
// Seconds to wait before the second and third attempt. A gallery that timed out after three minutes
// is not helped by asking again at once.
const pauses = [30, 60];

// Whether vsce's output describes a failure that could pass on its own. A 5xx only counts by its
// reason phrase, in parentheses the way vsce writes it (`Failed Request: Bad Gateway(502)`), or
// after "status": the version in the .vsix name is three bare numbers too, and a pre-release patch
// is the run number, which will pass 500.
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

function publishOnce(options) {
	const args = ['--no-install', '@vscode/vsce', 'publish', '--packagePath', options.vsix, '--skip-duplicate'];
	if (options.preRelease) {
		args.push('--pre-release');
	}
	args.push('--pat', options.pat);

	// The output is both shown as it happens and kept, because the retry decision reads it.
	const result = spawnSync('npx', args, { encoding: 'utf8', shell: process.platform === 'win32' });
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	process.stdout.write(output);
	if (result.error) {
		process.stdout.write(`${result.error.message}\n`);
	}
	return { ok: result.status === 0, output: result.error ? `${output}${result.error.message}` : output };
}

function publish(options) {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const result = publishOnce(options);
		if (result.ok) {
			return true;
		}
		if (attempt === attempts || !isTransient(result.output)) {
			return false;
		}
		const pause = pauses[attempt - 1];
		process.stdout.write(`::warning::Attempt ${attempt} of ${attempts} failed on what looks like a Marketplace or network hiccup; trying again in ${pause}s.\n`);
		sleep(pause);
	}
	return false;
}

function parseArgs(argv) {
	const options = { vsix: '', preRelease: false, pat: process.env.VSCE_PAT ?? '' };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--vsix':
				options.vsix = value ?? '';
				i++;
				break;
			case '--pre-release':
				options.preRelease = true;
				break;
			default:
				break;
		}
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.vsix) {
		process.stderr.write('::error::--vsix <file> is required.\n');
		process.exit(2);
	}
	if (!options.pat) {
		process.stderr.write('::error::VSCE_PAT is not set, so nothing can reach the VS Code Marketplace. Create a\n');
		process.stderr.write('::error::personal access token with Marketplace: Manage scope at\n');
		process.stderr.write('::error::https://dev.azure.com and add it as the repository secret VSCE_PAT.\n');
		process.exit(1);
	}
	process.exit(publish(options) ? 0 : 1);
}

if (require.main === module) {
	main();
}

module.exports = { attempts, isTransient, parseArgs, pauses };
