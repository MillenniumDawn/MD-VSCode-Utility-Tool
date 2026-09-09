import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// The runner behind `npm run pretest`. It lives outside src/ so CI can run it without a build, so
// it is pulled in through require the way the other scripts/ helpers are.
//
// What is being guarded here is that a failing compilation actually fails the run. The shell
// one-liner this replaced could not: in `sh` a bare `wait` with no operands exits 0 whatever the
// background jobs did, so every branch's "Compile tests" step passed and mocha then ran against a
// build that had failed to type-check.
const compileTests = require('../../../scripts/compile-tests');

const repoRoot = path.join(__dirname, '..', '..', '..');

interface Outcome {
    code?: number;
    output?: string;
    error?: string;
}

// Stands in for a tsc process: emits whatever the plan says on stdout, then closes with its code.
// A plan entry carrying `error` never starts at all, which is what a missing binary looks like.
function fakeSpawner(plan: Record<string, Outcome>) {
    const started: string[] = [];

    function spawn(project: string) {
        started.push(project);

        const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();

        const outcome = plan[project] ?? { code: 0 };
        setImmediate(() => {
            if (outcome.output) {
                child.stdout.emit('data', Buffer.from(outcome.output));
            }
            if (outcome.error) {
                child.emit('error', new Error(outcome.error));
                return;
            }
            child.emit('close', outcome.code ?? 0);
        });

        return child;
    }

    return { spawn, started };
}

async function runCapturing(projects: string[], spawn: (project: string) => unknown) {
    const write = process.stdout.write;
    let output = '';

    process.stdout.write = ((chunk: string | Uint8Array) => {
        output += chunk.toString();
        return true;
    }) as typeof process.stdout.write;

    try {
        const code = await compileTests.run(projects, spawn);
        return { code, output };
    } finally {
        process.stdout.write = write;
    }
}

describe('scripts/compile-tests', function () {
    describe('run', function () {
        it('succeeds when every project compiles', async function () {
            const spawner = fakeSpawner({ a: { code: 0 }, b: { code: 0 } });

            const result = await runCapturing(['a', 'b'], spawner.spawn);

            assert.strictEqual(result.code, 0);
            assert.deepStrictEqual(spawner.started, ['a', 'b']);
        });

        it('fails when the first project fails', async function () {
            const spawner = fakeSpawner({ a: { code: 1, output: 'a.ts(1,1): error TS2322\n' }, b: { code: 0 } });

            const result = await runCapturing(['a', 'b'], spawner.spawn);

            assert.notStrictEqual(result.code, 0);
            assert.ok(result.output.includes('error TS2322'));
        });

        it('fails when the second project fails', async function () {
            const spawner = fakeSpawner({ a: { code: 0 }, b: { code: 1, output: 'b.ts(1,1): error TS2322\n' } });

            const result = await runCapturing(['a', 'b'], spawner.spawn);

            assert.notStrictEqual(result.code, 0);
            assert.ok(result.output.includes('error TS2322'));
        });

        it('reports both projects when both fail rather than stopping at the first', async function () {
            const spawner = fakeSpawner({
                a: { code: 1, output: 'a.ts(1,1): error TS1111\n' },
                b: { code: 2, output: 'b.ts(1,1): error TS2222\n' },
            });

            const result = await runCapturing(['a', 'b'], spawner.spawn);

            assert.notStrictEqual(result.code, 0);
            assert.deepStrictEqual(spawner.started, ['a', 'b']);
            assert.ok(result.output.includes('error TS1111'));
            assert.ok(result.output.includes('error TS2222'));
        });

        it('names the failing project so its diagnostics can be told apart', async function () {
            const spawner = fakeSpawner({ 'tsconfig.webview.test.json': { code: 1 } });

            const result = await runCapturing(['tsconfig.test.json', 'tsconfig.webview.test.json'], spawner.spawn);

            assert.ok(result.output.includes('tsconfig.webview.test.json FAILED'));
            assert.ok(result.output.includes('tsconfig.test.json ok'));
        });

        it('treats a compiler that never starts as a failure', async function () {
            const spawner = fakeSpawner({ a: { error: 'spawn ENOENT' }, b: { code: 0 } });

            const result = await runCapturing(['a', 'b'], spawner.spawn);

            assert.notStrictEqual(result.code, 0);
            assert.ok(result.output.includes('spawn ENOENT'));
        });
    });

    describe('the projects it compiles', function () {
        it('names test projects that exist', function () {
            assert.ok(compileTests.projects.length > 0);
            for (const project of compileTests.projects) {
                assert.ok(fs.existsSync(path.join(repoRoot, project)), `${project} is missing`);
            }
        });

        // Second line of defence: even if the exit code were ever swallowed again, a failed
        // compilation must not leave fresh JS behind for mocha to run.
        it('compiles projects that refuse to emit on an error', function () {
            for (const project of compileTests.projects) {
                const config = JSON.parse(fs.readFileSync(path.join(repoRoot, project), 'utf8'));
                assert.strictEqual(config.compilerOptions.noEmitOnError, true, `${project} may emit despite errors`);
            }
        });
    });

    describe('package.json', function () {
        it('runs the tests through the runner, not a shell line that cannot fail', function () {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

            assert.ok(pkg.scripts.pretest.includes('scripts/compile-tests.js'));
            // `cmd & cmd & wait` is green in sh whatever tsc said, and red in cmd.exe whatever tsc
            // said. Neither is a check.
            assert.ok(!/(^|\s|&)wait(\s|$)/.test(pkg.scripts.pretest), 'pretest is back to a bare wait');
        });

        // cmd.exe, which is what npm runs scripts through on Windows, does not strip single quotes:
        // mocha would be handed a pattern with the quotes still in it and match no files at all.
        // Double quotes are stripped there and still keep sh from expanding the glob itself.
        it('quotes the mocha globs so they survive both shells', function () {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

            for (const script of ['test', 'test:coverage']) {
                assert.ok(!pkg.scripts[script].includes("'"), `${script} single-quotes its globs`);
            }
        });
    });
});
