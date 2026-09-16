import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
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

// The fake projects have no tsconfig on disk, so the purge is a no-op unless a test wants to watch it.
async function runCapturing(projects: string[], spawn: (project: string) => unknown, purge: (project: string) => void = () => undefined) {
    const write = process.stdout.write;
    let output = '';

    process.stdout.write = ((chunk: string | Uint8Array) => {
        output += chunk.toString();
        return true;
    }) as typeof process.stdout.write;

    try {
        const code = await compileTests.run(projects, spawn, purge);
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

        // tsc only ever writes, so a compiler started over a directory still holding the JS of a
        // deleted test would leave that test in the mocha glob. Every purge has to land first.
        it('purges every project before starting any compiler', async function () {
            const events: string[] = [];
            const spawner = fakeSpawner({ a: { code: 0 }, b: { code: 0 } });

            const result = await runCapturing(['a', 'b'], (project) => {
                events.push(`spawn:${project}`);
                return spawner.spawn(project);
            }, (project) => {
                events.push(`purge:${project}`);
            });

            assert.strictEqual(result.code, 0);
            assert.deepStrictEqual(events, ['purge:a', 'purge:b', 'spawn:a', 'spawn:b']);
        });
    });

    describe('purge', function () {
        let root: string;

        beforeEach(function () {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-tests-'));
        });

        afterEach(function () {
            fs.rmSync(root, { recursive: true, force: true });
        });

        function writeConfig(name: string, compilerOptions: Record<string, unknown>) {
            fs.writeFileSync(path.join(root, name), JSON.stringify({ compilerOptions }));
        }

        it('removes the output directory named by the project, stale files and all', function () {
            writeConfig('tsconfig.json', { outDir: 'out' });
            fs.mkdirSync(path.join(root, 'out', 'src', 'test'), { recursive: true });
            fs.writeFileSync(path.join(root, 'out', 'src', 'test', 'deleted.test.js'), '');
            fs.writeFileSync(path.join(root, 'out', '.tsbuildinfo'), '');

            compileTests.purge('tsconfig.json', root);

            assert.ok(!fs.existsSync(path.join(root, 'out')));
        });

        it('is fine when there is nothing to remove yet', function () {
            writeConfig('tsconfig.json', { outDir: 'out' });

            assert.doesNotThrow(() => compileTests.purge('tsconfig.json', root));
        });

        it('refuses a project with no outDir', function () {
            writeConfig('tsconfig.json', {});

            assert.throws(() => compileTests.purge('tsconfig.json', root), /outDir/);
        });

        it('refuses a project that emits into the root itself', function () {
            writeConfig('tsconfig.json', { outDir: '.' });
            fs.writeFileSync(path.join(root, 'keep.txt'), '');

            assert.throws(() => compileTests.purge('tsconfig.json', root), /root/);
            assert.ok(fs.existsSync(path.join(root, 'keep.txt')));
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

        // The output directory is purged before every compile, so an incremental build would only
        // write a .tsbuildinfo it never gets to read -- and it was the incremental build that let
        // the JS of deleted sources pile up in the first place.
        it('compiles projects that are not incremental', function () {
            for (const project of compileTests.projects) {
                const config = JSON.parse(fs.readFileSync(path.join(repoRoot, project), 'utf8'));
                assert.strictEqual(config.compilerOptions.incremental, undefined, `${project} is incremental`);
                assert.strictEqual(config.compilerOptions.tsBuildInfoFile, undefined, `${project} names a tsBuildInfoFile`);
            }
        });

        it('purges the directories mocha reads from', function () {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

            for (const project of compileTests.projects) {
                const outDir = path.relative(repoRoot, compileTests.outputDir(project)).replace(/\\/g, '/');
                assert.ok(pkg.scripts.test.includes(`${outDir}/`), `${project} emits into ${outDir}, which the test script does not read`);
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
        it('cleans the test output along with the build output', function () {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

            for (const project of compileTests.projects) {
                const outDir = path.relative(repoRoot, compileTests.outputDir(project)).replace(/\\/g, '/');
                assert.ok(pkg.scripts.clean.split(/\s+/).includes(outDir), `clean does not remove ${outDir}`);
            }
        });

        it('quotes the mocha globs so they survive both shells', function () {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

            for (const script of ['test', 'test:coverage']) {
                assert.ok(!pkg.scripts[script].includes("'"), `${script} single-quotes its globs`);
            }
        });
    });
});
