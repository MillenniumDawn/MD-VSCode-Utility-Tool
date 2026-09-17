// Fails when the lines a branch added or changed are not covered by the unit tests.
//
//   npm run test:coverage
//   node scripts/diff-coverage.js --base origin/main...HEAD
//
// The whole-suite thresholds in package.json's c8 block are deliberately loose: they sit a few
// points under the real figure so a normal branch never trips them, which also means a branch can
// add a few thousand untested lines before they say a word. This is the rule that actually keeps
// coverage from sliding: of the changed lines c8 instrumented, at least --min percent must have run
// under a test. Lines c8 did not instrument -- tests, documentation, blank lines, deleted files --
// are not measured at all, and a branch with nothing measurable passes.
//
// --base is handed to `git diff` verbatim. Locally that is `origin/main...HEAD`, the branch's own
// changes. In CI the checkout is the pull request's merge commit, so `HEAD^1` is the base branch
// as of that run and the diff is exactly what the pull request adds.
//
// Exit code 0 means covered enough (or nothing to measure); 1 means the gate failed, with every
// uncovered line written as a GitHub annotation so it shows up inline on the pull request. The
// summary also goes to $GITHUB_STEP_SUMMARY when that is set.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// c8 writes `SF:` relative to the working directory with the platform's separator on Windows, and
// other lcov writers use absolute paths; git always prints forward slashes relative to the root.
function repoRelative(file, root) {
	const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
	return relative.split('\\').join('/');
}

// Map of repo-relative path -> Map of line -> hit count, one entry per `DA:` record.
function parseLcov(text, root = repoRoot) {
	const coverage = new Map();
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		if (line.startsWith('SF:')) {
			current = new Map();
			coverage.set(repoRelative(line.slice(3).trim(), root), current);
		} else if (line.startsWith('DA:') && current !== null) {
			const [lineNumber, hits] = line.slice(3).split(',');
			current.set(Number(lineNumber), Number(hits));
		} else if (line === 'end_of_record') {
			current = null;
		}
	}
	return coverage;
}

// Map of repo-relative path -> Set of line numbers the diff added or rewrote, read from a
// `--unified=0` diff. Removed lines have no line to cover; a deleted file has no `+++ b/` path.
function changedLines(diffText) {
	const changed = new Map();
	let current = null;
	for (const line of diffText.split(/\r?\n/)) {
		if (line.startsWith('+++ ')) {
			const target = line.slice(4).trim();
			current = target.startsWith('b/') ? new Set() : null;
			if (current !== null) {
				changed.set(target.slice(2), current);
			}
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk === null || current === null) {
			continue;
		}
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		for (let n = start; n < start + count; n++) {
			current.add(n);
		}
	}
	return changed;
}

function evaluate(coverage, changed, minimum) {
	let measured = 0;
	let covered = 0;
	const uncovered = [];
	for (const [file, lines] of changed) {
		const fileCoverage = coverage.get(file);
		if (fileCoverage === undefined) {
			continue;
		}
		for (const line of [...lines].sort((a, b) => a - b)) {
			const hits = fileCoverage.get(line);
			if (hits === undefined) {
				continue;
			}
			measured++;
			if (hits > 0) {
				covered++;
			} else {
				uncovered.push({ file, line });
			}
		}
	}
	const percent = measured === 0 ? 100 : (covered / measured) * 100;
	return { measured, covered, percent, uncovered, pass: measured === 0 || percent >= minimum };
}

function parseArgs(argv) {
	const options = { base: 'origin/main...HEAD', lcov: path.join('coverage', 'lcov.info'), min: 80 };
	for (let i = 0; i < argv.length; i += 2) {
		const value = argv[i + 1];
		if (value === undefined) {
			throw new Error(`Missing value for ${argv[i]}`);
		}
		if (argv[i] === '--base') {
			options.base = value;
		} else if (argv[i] === '--lcov') {
			options.lcov = value;
		} else if (argv[i] === '--min') {
			options.min = Number(value);
			if (Number.isNaN(options.min)) {
				throw new Error(`--min wants a number, got ${value}`);
			}
		} else {
			throw new Error(`Unknown option ${argv[i]}`);
		}
	}
	return options;
}

function main(argv) {
	const options = parseArgs(argv);
	const lcovPath = path.resolve(repoRoot, options.lcov);
	if (!fs.existsSync(lcovPath)) {
		throw new Error(`No coverage report at ${lcovPath}; run \`npm run test:coverage\` first.`);
	}
	const coverage = parseLcov(fs.readFileSync(lcovPath, 'utf8'));
	const diff = execFileSync(
		'git',
		['diff', '--unified=0', '--no-color', '--diff-filter=AM', options.base, '--', 'src', 'webviewsrc'],
		{ cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const result = evaluate(coverage, changedLines(diff), options.min);

	for (const { file, line } of result.uncovered) {
		console.log(`::warning file=${file},line=${line}::Changed line is not covered by a test`);
	}
	const summary =
		result.measured === 0
			? 'Coverage on changed lines: nothing measurable changed.'
			: `Coverage on changed lines: ${result.covered}/${result.measured} (${result.percent.toFixed(1)}%), minimum ${options.min}%: ${result.pass ? 'pass' : 'FAIL'}.`;
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
	}
	return result.pass ? 0 : 1;
}

module.exports = { parseLcov, changedLines, evaluate, parseArgs };

if (require.main === module) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
