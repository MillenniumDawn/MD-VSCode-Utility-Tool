import * as assert from 'assert';
import { fnv1a32, fnv1a32Value, fnv1a64Hex } from '../util/hash';

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

    describe('fnv1a32Value', () => {
        it('is deterministic for equal structures and stays a 32-bit unsigned value', () => {
            const make = () => ({ styleCss: '.x{}', data: { mios: [{ id: 'a', traits: { t: { x: 1, y: 2 } } }], flag: true, none: null } });
            const hash = fnv1a32Value(make());
            assert.strictEqual(hash, fnv1a32Value(make()));
            assert.ok(Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff);
        });

        it('moves when a leaf changes', () => {
            assert.notStrictEqual(fnv1a32Value({ data: { mios: [1] } }), fnv1a32Value({ data: { mios: [2] } }));
            assert.notStrictEqual(fnv1a32Value({ data: { s: 'a' } }), fnv1a32Value({ data: { s: 'b' } }));
            assert.notStrictEqual(fnv1a32Value({ data: { b: true } }), fnv1a32Value({ data: { b: false } }));
        });

        it('separates array order, key order and a value that moved between keys', () => {
            assert.notStrictEqual(fnv1a32Value([1, 2]), fnv1a32Value([2, 1]));
            assert.notStrictEqual(fnv1a32Value({ a: 1, b: 2 }), fnv1a32Value({ b: 2, a: 1 }));
            assert.notStrictEqual(fnv1a32Value({ a: 1, b: 2 }), fnv1a32Value({ a: 2, b: 1 }));
        });

        // The walk feeds the strings into one running hash, so without a boundary the two payloads
        // below would be the same byte stream.
        it('does not collide when a string boundary shifts between neighbours', () => {
            assert.notStrictEqual(fnv1a32Value({ a: 'ab', b: 'c' }), fnv1a32Value({ a: 'a', b: 'bc' }));
            assert.notStrictEqual(fnv1a32Value(['ab', 'c']), fnv1a32Value(['a', 'bc']));
        });

        it('keeps a primitive apart from its string form and nesting apart from flattening', () => {
            assert.notStrictEqual(fnv1a32Value(1), fnv1a32Value('1'));
            assert.notStrictEqual(fnv1a32Value(null), fnv1a32Value('null'));
            assert.notStrictEqual(fnv1a32Value(undefined), fnv1a32Value(null));
            assert.notStrictEqual(fnv1a32Value([[1], 2]), fnv1a32Value([1, [2]]));
            assert.notStrictEqual(fnv1a32Value({ a: { b: 1 } }), fnv1a32Value({ a: 1, b: 1 }));
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
