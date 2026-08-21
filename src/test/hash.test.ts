import * as assert from 'assert';
import { fnv1a32, fnv1a64Hex } from '../util/hash';

describe('util/hash', () => {
    describe('fnv1a32', () => {
        // The published FNV-1a 32-bit vectors. The three copies this replaced multiplied with `*`
        // rather than Math.imul, which loses the low bits once the product passes 2^53, so none of
        // them produced these.
        it('matches the reference vectors', () => {
            assert.strictEqual(fnv1a32(''), 0x811c9dc5);
            assert.strictEqual(fnv1a32('a'), 0xe40c292c);
            assert.strictEqual(fnv1a32('foobar'), 0xbf9cf968);
        });

        it('is deterministic and stays a 32-bit unsigned value', () => {
            const inputs = ['', 'a', 'foobar', 'x'.repeat(5000), 'ÿ '];
            for (const input of inputs) {
                const hash = fnv1a32(input);
                assert.strictEqual(hash, fnv1a32(input), `stable for ${input.slice(0, 12)}`);
                assert.ok(Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff);
            }
        });

        it('separates inputs that differ only in order', () => {
            assert.notStrictEqual(fnv1a32('ab'), fnv1a32('ba'));
        });

        it('walks the string backwards when asked, giving a different hash', () => {
            assert.strictEqual(fnv1a32('abc', 0x811c9dc5, true), fnv1a32('cba'));
            assert.notStrictEqual(fnv1a32('abc', 0x811c9dc5, true), fnv1a32('abc'));
        });
    });

    describe('fnv1a64Hex', () => {
        it('is 16 lowercase hex characters', () => {
            for (const input of ['', 'a', 'mod:foo\nws:bar']) {
                assert.match(fnv1a64Hex(input), /^[0-9a-f]{16}$/);
            }
        });

        it('is deterministic, which is what the cache namespace depends on', () => {
            assert.strictEqual(fnv1a64Hex('mod:foo\nws:bar'), fnv1a64Hex('mod:foo\nws:bar'));
        });

        // The two halves run in opposite directions from different bases so they do not move
        // together; a one-character change has to disturb both.
        it('changes both halves when the input changes', () => {
            const a = fnv1a64Hex('mod:foo\nws:bar');
            const b = fnv1a64Hex('mod:foo\nws:baz');
            assert.notStrictEqual(a.slice(0, 8), b.slice(0, 8));
            assert.notStrictEqual(a.slice(8), b.slice(8));
        });

        it('distinguishes inputs that differ only in order', () => {
            assert.notStrictEqual(fnv1a64Hex('ab'), fnv1a64Hex('ba'));
        });
    });
});
