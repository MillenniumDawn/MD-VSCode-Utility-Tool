// The version and tag a pre-release build goes out as.
//
//   node scripts/prerelease-version.js            # report only
//   node scripts/prerelease-version.js --apply    # and write it into package.json
//
// GITHUB_RUN_NUMBER and GITHUB_RUN_ATTEMPT say which build this is; --run-number and --run-attempt
// override them. The answer is written to $GITHUB_OUTPUT as `version` and `tag`, and
// .github/workflows/pre-release.yml packages and publishes from there.
//
// VS Code's channel convention: stable takes the even minors and the pre-release channel takes the
// odd minor directly above, so a pre-release is always ahead of the stable release it was built
// from. The Actions run number is the patch, which only ever climbs, so a pre-release version is
// never reused and never collides with a stable patch.
//
// The version stays plain digits because VS Code rejects a SemVer prerelease suffix in an extension
// version. Only the Git tag carries one -- v1.3.57-pre.2 for extension version 1.3.57 -- which is
// what keeps a rerun of the same build from trying to write a tag that already exists.
//
// Nothing here is committed. The workflow writes package.json in its own checkout and throws it
// away; CHANGELOG.md is never touched, because a pre-release is not a release.

'use strict';

const fs = require('fs');
const path = require('path');

const { parseVersion, readVersion, stableMinor, writeVersion } = require('./bump-version');

function positiveInteger(value, what) {
	const text = String(value ?? '').trim();
	if (!/^\d+$/.test(text) || Number(text) < 1) {
		throw new Error(`The ${what} must be a positive whole number, not: ${value}`);
	}
	return Number(text);
}

// The version and tag for one pre-release build, and a warning when the stable line it was derived
// from is not where it should be.
function prereleaseIdentity(options = {}) {
	const [major, minor] = parseVersion(options.version);
	const run = positiveInteger(options.runNumber, 'run number');
	const attempt = positiveInteger(options.runAttempt ?? 1, 'run attempt');

	const version = `${major}.${stableMinor(minor) + 1}.${run}`;
	// Stable is meant to sit on an even minor. This repository does not yet, so the odd minor is
	// rounded up to the even line it belongs to rather than failing the build -- 1.1.x and 1.2.x both
	// produce 1.3.x pre-releases, so moving stable onto 1.2.0 later changes nothing here.
	const warning = minor % 2 === 0
		? undefined
		: `Stable is on ${major}.${minor}, an odd minor, which is where pre-releases belong. `
			+ `Pre-releases are derived from the ${major}.${stableMinor(minor)} line above it instead.`;

	return { version, tag: `v${version}-pre.${attempt}`, warning };
}

function evaluate(options = {}) {
	const root = options.cwd ?? process.cwd();
	const packageJsonPath = path.join(root, 'package.json');
	const packageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
	const stable = readVersion(packageJsonText);

	const identity = prereleaseIdentity({ ...options, version: stable });

	if (options.apply) {
		fs.writeFileSync(packageJsonPath, writeVersion(packageJsonText, identity.version));
	}

	return { ...identity, stable, applied: options.apply === true };
}

function report(result) {
	if (result.warning) {
		process.stdout.write(`::warning::${result.warning}\n`);
	}
	const notice = `Pre-release ${result.version} from stable ${result.stable}, tagged ${result.tag}.`;
	process.stdout.write(`::notice::${notice}\n`);

	const outputPath = process.env.GITHUB_OUTPUT;
	if (outputPath) {
		fs.appendFileSync(outputPath, `version=${result.version}\ntag=${result.tag}\n`);
	}

	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		fs.appendFileSync(summaryPath, `### Pre-release\n\n${notice}\n`);
	}
}

function parseArgs(argv) {
	const options = {
		apply: false,
		runNumber: process.env.GITHUB_RUN_NUMBER ?? '',
		runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
	};
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--apply':
				options.apply = true;
				break;
			case '--run-number':
				options.runNumber = value;
				i++;
				break;
			case '--run-attempt':
				options.runAttempt = value;
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

module.exports = { evaluate, parseArgs, prereleaseIdentity };
