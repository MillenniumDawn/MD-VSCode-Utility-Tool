import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// c8 runs with `all: true` over out-test/src/**, which only reports what tsc actually emitted.
// A source file that no test imports used to be left out of the emit and vanish from the
// coverage table altogether rather than show up at 0%, so tsconfig.test.json now includes
// src/**/*.ts as a whole. This keeps that true: every shipped source must have its JS beside
// the tests in out-test.
const repoRoot = path.join(__dirname, '..', '..', '..');
const sourceRoot = path.join(repoRoot, 'src');
const emitRoot = path.join(repoRoot, 'out-test', 'src');

function shippedSources(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (full !== path.join(sourceRoot, 'test')) {
                files.push(...shippedSources(full));
            }
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            files.push(full);
        }
    }
    return files;
}

describe('test emit', () => {
    it('emits every shipped source under src/ into out-test', () => {
        const sources = shippedSources(sourceRoot);
        assert.ok(sources.length > 0, 'no sources found under src/');

        const missing = sources
            .filter(source => !fs.existsSync(path.join(emitRoot, path.relative(sourceRoot, source)).replace(/\.ts$/, '.js')))
            .map(source => path.relative(repoRoot, source));

        assert.deepStrictEqual(missing, [], `sources missing from out-test (not included by tsconfig.test.json): ${missing.join(', ')}`);
    });
});
