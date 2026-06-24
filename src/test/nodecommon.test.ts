import * as assert from 'assert';
import * as path from 'path';
import { isSamePath, matchPathEnd } from '../util/nodecommon';

describe('util/nodecommon', () => {
    describe('matchPathEnd', () => {
        it('matches an exact path segment by segment', () => {
            assert.strictEqual(matchPathEnd('/a/b/c.txt', ['a', 'b', 'c.txt']), true);
            assert.strictEqual(matchPathEnd('a/b/c.txt', ['a', 'b', 'c.txt']), true);
        });

        it('is case-insensitive on every segment', () => {
            assert.strictEqual(matchPathEnd('/A/B/C.TXT', ['a', 'b', 'c.txt']), true);
            assert.strictEqual(matchPathEnd('/a/b/c.txt', ['A', 'B', 'C.TXT']), true);
        });

        it('treats forward and back slashes as equivalent', () => {
            assert.strictEqual(matchPathEnd('a\\b\\c.txt', ['a', 'b', 'c.txt']), true);
            assert.strictEqual(matchPathEnd('a/b/c.txt', ['a', 'b', 'c.txt']), true);
        });

        it('skips one directory when the segment is "*"', () => {
            // `*` still walks the path one level up, it just skips the basename
            // comparison at that step. So `/a/x/b/c.txt` matched against
            // `['a', '*', 'b', 'c.txt']` consumes four levels: c.txt, b, (skip), a.
            assert.strictEqual(matchPathEnd('/a/x/b/c.txt', ['a', '*', 'b', 'c.txt']), true);
            assert.strictEqual(matchPathEnd('/A/Anything/B/C.TXT', ['a', '*', 'b', 'c.txt']), true);
        });

        it('returns false when the trailing segment does not match', () => {
            assert.strictEqual(matchPathEnd('/a/b/c.txt', ['a', 'b', 'other.txt']), false);
        });

        it('returns false when an intermediate segment does not match', () => {
            assert.strictEqual(matchPathEnd('/a/b/c.txt', ['a', 'x', 'c.txt']), false);
        });

        it('returns false when segments run longer than the path', () => {
            assert.strictEqual(matchPathEnd('/a/b', ['a', 'b', 'c']), false);
        });

        it('returns true for an empty segment list', () => {
            assert.strictEqual(matchPathEnd('/a/b/c.txt', []), true);
        });

        it('compares only the basename of the last segment', () => {
            // The loop checks `path.basename(pathname)` at the very end before walking up, so
            // `c.txt` matches the trailing file. Intermediate segments are full directory names.
            assert.strictEqual(matchPathEnd('/dir/c.txt', ['c.txt']), true);
        });
    });

    describe('isSamePath', () => {
        it('returns true for identical absolute paths', () => {
            assert.strictEqual(isSamePath('/a/b/c.txt', '/a/b/c.txt'), true);
        });

        it('returns true for the same path with different cases', () => {
            assert.strictEqual(isSamePath('/A/B/C.txt', '/a/b/c.txt'), true);
        });

        it('returns false for paths that differ in any segment', () => {
            assert.strictEqual(isSamePath('/a/b/c.txt', '/a/b/d.txt'), false);
        });

        it('treats a trailing separator as the same directory', () => {
            // path.resolve collapses the trailing slash.
            assert.strictEqual(isSamePath(path.sep + 'a' + path.sep, path.sep + 'a'), true);
        });

        it('returns false when one path is a parent of the other', () => {
            assert.strictEqual(isSamePath('/a/b', '/a/b/c'), false);
        });
    });
});
