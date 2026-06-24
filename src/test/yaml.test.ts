import * as assert from 'assert';
import { parseYaml } from '../util/yaml';

describe('util/yaml', () => {
    describe('parseYaml', () => {
        it('parses a flat mapping', () => {
            const result = parseYaml('a: 1\nb: hello\nc: true');
            assert.deepStrictEqual(result, { a: 1, b: 'hello', c: true });
        });

        it('parses nested mappings', () => {
            const result = parseYaml('outer:\n  inner:\n    leaf: 7');
            assert.deepStrictEqual(result, { outer: { inner: { leaf: 7 } } });
        });

        it('parses an empty document as undefined', () => {
            assert.strictEqual(parseYaml(''), undefined);
        });

        it('parses a sequence at the top level', () => {
            const result = parseYaml('- 1\n- 2\n- 3');
            assert.deepStrictEqual(result, [1, 2, 3]);
        });

        it('parses a value that contains an unescaped double quote', () => {
            // js-yaml's plain-scalar rules let this through with a literal `"` in the value.
            const result = parseYaml('k: "a "b" c"');
            assert.strictEqual(result.k, 'a "b" c');
        });

        it('throws on input that js-yaml cannot repair', () => {
            // Unbalanced flow brackets with no closing `]` — neither patch regex
            // (`:N "` and the mid-line quote escape) matches, so the second safeLoad
            // throws too. This is the safety net: the patch is best-effort, not
            // load-bearing for current js-yaml versions (which accept most
            // version-suffixed strings as plain scalars), but parseYaml must still
            // surface a real YAML syntax error rather than swallow it.
            assert.throws(() => parseYaml('key: [unterminated'), /end of the stream|JSON|expected/);
        });
    });
});
