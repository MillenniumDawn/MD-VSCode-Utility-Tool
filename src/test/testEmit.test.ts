import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { walkFiles } from './unit/files';

// c8 runs with `all: true` over out-test/src/**, which only reports what tsc actually emitted.
// A source file that no test imports used to be left out of the emit and vanish from the
// coverage table altogether rather than show up at 0%, so tsconfig.test.json now includes
// src/**/*.ts as a whole. This keeps that true: every shipped source must have its JS beside
// the tests in out-test.
const repoRoot = path.join(__dirname, '..', '..', '..');
const sourceRoot = path.join(repoRoot, 'src');
const emitRoot = path.join(repoRoot, 'out-test', 'src');

describe('test emit', () => {
    it('emits every shipped source under src/ into out-test', () => {
        const sources = walkFiles(sourceRoot, file => file.endsWith('.ts') && !file.endsWith('.d.ts'),
            [path.join(sourceRoot, 'test')]);
        assert.ok(sources.length > 0, 'no sources found under src/');

        const missing = sources
            .filter(source => !fs.existsSync(path.join(emitRoot, path.relative(sourceRoot, source)).replace(/\.ts$/, '.js')))
            .map(source => path.relative(repoRoot, source));

        assert.deepStrictEqual(missing, [], `sources missing from out-test (not included by tsconfig.test.json): ${missing.join(', ')}`);
    });
});
