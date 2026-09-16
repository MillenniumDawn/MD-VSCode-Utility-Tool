// Type-checks both test projects in parallel and fails if either one fails.
//
// Why this exists: `pretest` used to be the shell one-liner
// `tsc -p ./tsconfig.test.json & tsc -p ./tsconfig.webview.test.json & wait`, which could not
// report the truth on either platform. In `sh` a bare `wait` with no operands exits 0 whatever the
// background jobs did, so CI's "Compile tests" step was green no matter what tsc said -- and since
// neither project set `noEmitOnError`, mocha then ran against a build that had failed to
// type-check. In `cmd.exe`, which is what npm uses on Windows, `&` is a sequential separator rather
// than a background operator, so the line ran both compilations and then `wait`, which is not a
// command: local `npm test` aborted in `pretest` every time.
//
// Both children are always started and always awaited. A failure in the first project must not hide
// the second project's diagnostics, because the point of a run is to see every error at once.
// Output is buffered per project and printed after that child exits: two tsc processes writing at
// the same time interleave their multi-line diagnostics into nonsense.
//
// Each project's output directory is emptied before its compiler starts. tsc only ever writes: the
// JS of a source file that was deleted stays behind, still matches the mocha glob and still runs,
// so a local `npm test` measured code that no longer existed while CI, which starts clean, did not.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

const projects = ['tsconfig.test.json', 'tsconfig.webview.test.json'];

// `spawn('tsc')` does not find the local binary, and on Windows what is on disk is `tsc.cmd`, which
// only `shell: true` will run. Go through the local typescript package's own entry point instead,
// with the node that is already running this script.
function spawnTsc(project) {
	const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
	return spawn(process.execPath, [tsc, '-p', path.join(repoRoot, project)], { cwd: repoRoot });
}

// The directory a project emits into, read from its own tsconfig so the two cannot drift apart. An
// outDir that is missing or is the root itself is refused rather than handed to a recursive delete.
function outputDir(project, root = repoRoot) {
	const config = JSON.parse(fs.readFileSync(path.join(root, project), 'utf8'));
	const outDir = config.compilerOptions?.outDir;
	if (typeof outDir !== 'string' || outDir.trim() === '') {
		throw new Error(`${project} has no compilerOptions.outDir to purge`);
	}
	const resolved = path.resolve(root, outDir);
	if (resolved === path.resolve(root)) {
		throw new Error(`${project} emits into the repository root; refusing to purge it`);
	}
	return resolved;
}

function purge(project, root = repoRoot) {
	fs.rmSync(outputDir(project, root), { recursive: true, force: true });
}

// Resolves to the child's exit code, with everything it wrote on either stream. A child that never
// starts -- a missing binary, say -- reports its error the same way rather than rejecting, so one
// broken project still lets the other one finish and print.
function compile(project, spawnProject) {
	return new Promise((resolve) => {
		const child = spawnProject(project);
		let output = '';

		child.stdout?.on('data', (chunk) => {
			output += chunk.toString();
		});
		child.stderr?.on('data', (chunk) => {
			output += chunk.toString();
		});
		child.on('error', (error) => {
			resolve({ project, code: 1, output: `${output}${error.message}\n` });
		});
		child.on('close', (code) => {
			resolve({ project, code: code === null ? 1 : code, output });
		});
	});
}

async function run(projectList = projects, spawnProject = spawnTsc, purgeProject = purge) {
	for (const project of projectList) {
		purgeProject(project);
	}

	const results = await Promise.all(projectList.map((project) => compile(project, spawnProject)));

	for (const result of results) {
		const trimmed = result.output.trim();
		process.stdout.write(`--- ${result.project} ${result.code === 0 ? 'ok' : `FAILED (exit ${result.code})`}\n`);
		if (trimmed) {
			process.stdout.write(`${trimmed}\n`);
		}
	}

	return results.some((result) => result.code !== 0) ? 1 : 0;
}

if (require.main === module) {
	run().then((code) => {
		process.exit(code);
	});
}

module.exports = { compile, outputDir, projects, purge, run, spawnTsc };
