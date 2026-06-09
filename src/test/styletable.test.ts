import * as assert from 'assert';
import { StyleTable, normalizeForStyle } from '../util/styletable';

describe('util/styletable', () => {
    describe('StyleTable', () => {
        it('returns a stable, prefixed class name for a given base name', () => {
            const table = new StyleTable();
            const className = table.style('button', () => 'color: red;');
            assert.strictEqual(className, 'st-button');
        });

        it('caches the callback result for a given (name, pseudoClass) pair', () => {
            const table = new StyleTable();
            let calls = 0;
            const factory = () => { calls++; return 'color: red;'; };

            table.style('button', factory);
            table.style('button', factory);

            assert.strictEqual(calls, 1);
        });

        it('treats different pseudo classes as separate cache entries', () => {
            const table = new StyleTable();
            let calls = 0;
            const factory = () => { calls++; return 'color: red;'; };

            table.style('button', factory, ':hover');
            table.style('button', factory, ':active');

            assert.strictEqual(calls, 2);
        });

        it('awaits an async callback and caches its result', async () => {
            const table = new StyleTable();
            let calls = 0;
            const factory = async () => { calls++; await Promise.resolve(); return 'color: blue;'; };

            const first = await table.style('link', factory);
            const second = await table.style('link', factory);

            assert.strictEqual(first, 'st-link');
            assert.strictEqual(second, 'st-link');
            assert.strictEqual(calls, 1);
        });

        it('oneTimeStyle generates a unique class per call so styles are not shared', () => {
            const table = new StyleTable();
            const a = table.oneTimeStyle('dynamic', () => 'color: red;');
            const b = table.oneTimeStyle('dynamic', () => 'color: red;');

            assert.notStrictEqual(a, b);
            assert.ok(a.startsWith('st-dynamic-'));
            assert.ok(b.startsWith('st-dynamic-'));
        });

        it('toStyleElement renders both named styles and raw selector rules', () => {
            const table = new StyleTable();
            table.style('button', () => 'color: red;\n  background: white;');
            table.raw('.legacy', 'color: black;');

            const html = table.toStyleElement('abc123');
            assert.ok(html.includes('nonce="abc123"'));
            assert.ok(html.includes('.st-button'));
            assert.ok(html.includes('color: red;'));
            assert.ok(html.includes('background: white;'));
            assert.ok(html.includes('.legacy'));
        });

        it('name() is exposed as a public prefixing helper', () => {
            const table = new StyleTable();
            assert.strictEqual(table.name('foo'), 'st-foo');
        });
    });

    describe('normalizeForStyle', () => {
        it('leaves word characters and underscores untouched', () => {
            assert.strictEqual(normalizeForStyle('foo_bar_baz'), 'foo_bar_baz');
        });

        it('encodes non-word characters using their char code', () => {
            assert.strictEqual(normalizeForStyle('a.b'), 'a_46b');
            assert.strictEqual(normalizeForStyle('a:b'), 'a_58b');
        });

        it('replaces every offending character (not just the first)', () => {
            assert.strictEqual(normalizeForStyle('a.b.c'), 'a_46b_46c');
        });
    });
});
