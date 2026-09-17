import * as assert from 'assert';

// The changed-lines coverage gate CI runs after the unit tests. Plain CommonJS like the other
// workflow helpers, so it is required rather than imported.
const diffCoverage = require('../../../scripts/diff-coverage');

const lcov = [
    'TN:',
    'SF:src\\foo.ts',
    'DA:1,1',
    'DA:2,0',
    'DA:4,3',
    'end_of_record',
    'SF:/repo/webviewsrc/bar.ts',
    'DA:10,0',
    'end_of_record',
].join('\n');

const diff = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,0 +2,3 @@',
    '+a',
    '+b',
    '+c',
    '@@ -9 +9 @@',
    '-old',
    '+new',
    'diff --git a/src/gone.ts b/src/gone.ts',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,4 +0,0 @@',
    '-x',
    'diff --git a/webviewsrc/bar.ts b/webviewsrc/bar.ts',
    '--- a/webviewsrc/bar.ts',
    '+++ b/webviewsrc/bar.ts',
    '@@ -5,2 +5,0 @@',
    '-y',
    '-z',
    '@@ -12,0 +10 @@',
    '+w',
].join('\n');

describe('scripts/diff-coverage', function () {
    describe('parseLcov', function () {
        it('keys every record by its repo-relative posix path, whatever c8 or the platform wrote', function () {
            const coverage = diffCoverage.parseLcov(lcov, '/repo');
            assert.deepStrictEqual([...coverage.keys()], ['src/foo.ts', 'webviewsrc/bar.ts']);
            assert.deepStrictEqual([...coverage.get('src/foo.ts')], [[1, 1], [2, 0], [4, 3]]);
            assert.deepStrictEqual([...coverage.get('webviewsrc/bar.ts')], [[10, 0]]);
        });

        it('drops a DA line that arrives outside a record', function () {
            const coverage = diffCoverage.parseLcov('DA:1,1\nSF:src/a.ts\nend_of_record\nDA:2,1\n');
            assert.deepStrictEqual([...coverage.get('src/a.ts')], []);
        });
    });

    describe('changedLines', function () {
        it('collects the added lines of every hunk, with or without a count', function () {
            const changed = diffCoverage.changedLines(diff);
            assert.deepStrictEqual([...changed.get('src/foo.ts')], [2, 3, 4, 9]);
            assert.deepStrictEqual([...changed.get('webviewsrc/bar.ts')], [10]);
        });

        it('has nothing to say about a deleted file or a deletion-only hunk', function () {
            const changed = diffCoverage.changedLines(diff);
            assert.ok(!changed.has('src/gone.ts'));
            assert.ok(!changed.has('/dev/null'));
            assert.ok(!changed.get('webviewsrc/bar.ts').has(5));
        });
    });

    describe('evaluate', function () {
        const coverage = diffCoverage.parseLcov(lcov, '/repo');

        it('measures only the changed lines the report instrumented and names the ones that never ran', function () {
            // Line 3 of foo.ts has no DA record (blank or a comment) and does not count either way.
            const result = diffCoverage.evaluate(coverage, diffCoverage.changedLines(diff), 80);
            assert.strictEqual(result.measured, 3);
            assert.strictEqual(result.covered, 1);
            assert.deepStrictEqual(result.uncovered, [
                { file: 'src/foo.ts', line: 2 },
                { file: 'webviewsrc/bar.ts', line: 10 },
            ]);
            assert.strictEqual(result.pass, false);
        });

        it('passes at or above the minimum and fails below it', function () {
            const changed = new Map([['src/foo.ts', new Set([1, 2, 3, 4])]]);
            // Lines 1 and 4 ran, 2 did not, 3 was never instrumented: two of three.
            assert.strictEqual(diffCoverage.evaluate(coverage, changed, 66).pass, true);
            assert.strictEqual(diffCoverage.evaluate(coverage, changed, 67).pass, false);
        });

        it('passes a change that touched nothing the report knows about', function () {
            const changed = new Map([
                ['src/test/foo.test.ts', new Set([1, 2])],
                ['src/foo.ts', new Set([3])],
            ]);
            const result = diffCoverage.evaluate(coverage, changed, 100);
            assert.strictEqual(result.measured, 0);
            assert.strictEqual(result.pass, true);
        });
    });

    describe('parseArgs', function () {
        it('defaults to the branch against origin/main at 80 percent', function () {
            const options = diffCoverage.parseArgs([]);
            assert.strictEqual(options.base, 'origin/main...HEAD');
            assert.strictEqual(options.min, 80);
        });

        it('reads the flags CI passes and rejects what it does not know', function () {
            const options = diffCoverage.parseArgs(['--base', 'HEAD^1', '--min', '90']);
            assert.strictEqual(options.base, 'HEAD^1');
            assert.strictEqual(options.min, 90);
            assert.throws(() => diffCoverage.parseArgs(['--min', 'lots']), /wants a number/);
            assert.throws(() => diffCoverage.parseArgs(['--base']), /Missing value/);
            assert.throws(() => diffCoverage.parseArgs(['--fast', 'yes']), /Unknown option/);
        });
    });
});
