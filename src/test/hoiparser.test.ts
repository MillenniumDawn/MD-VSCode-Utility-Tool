import * as assert from 'assert';
import { parseHoi4File, resolveScriptVariables, Node } from '../hoiformat/hoiparser';

function child(node: Node, name: string): Node {
    const found = (node.value as Node[]).find(n => n.name === name);
    assert.ok(found, `expected a child named ${name}`);
    return found!;
}

describe('parseHoi4File', () => {
    it('parses numbers and strings', () => {
        const root = parseHoi4File('a = 1 b = "two"');
        assert.strictEqual(child(root, 'a').value, 1);
        assert.strictEqual(child(root, 'b').value, 'two');
    });

    it('keeps position tokens by default', () => {
        const root = parseHoi4File('a = 1');
        assert.notStrictEqual(child(root, 'a').nameToken, null);
    });

    it('drops position tokens when keepTokens is false', () => {
        const root = parseHoi4File('a = 1', '', { keepTokens: false });
        const a = child(root, 'a');
        assert.strictEqual(a.nameToken, null);
        assert.strictEqual(a.operatorToken, null);
        assert.strictEqual(a.valueStartToken, null);
        assert.strictEqual(a.valueEndToken, null);
        // Names and values must still be intact, since indices rely on them.
        assert.strictEqual(a.name, 'a');
        assert.strictEqual(a.value, 1);
    });
});

describe('resolveScriptVariables', () => {
    it('substitutes @constants used as nested numeric and string values', () => {
        const root = resolveScriptVariables(parseHoi4File([
            '@WIDTH = 200',
            '@TITLE = "hello"',
            'window = { size = { width = @WIDTH height = 50 } name = @TITLE }',
        ].join('\n')));

        const size = child(child(root, 'window'), 'size');
        assert.strictEqual(child(size, 'width').value, 200);
        assert.strictEqual(child(size, 'height').value, 50);
        assert.strictEqual(child(child(root, 'window'), 'name').value, 'hello');
    });

    it('leaves references to unknown @constants untouched', () => {
        const root = resolveScriptVariables(parseHoi4File('@A = 1\nx = @A\ny = @B'));
        assert.strictEqual(child(root, 'x').value, 1);
        assert.deepStrictEqual(child(root, 'y').value, { name: '@B' });
    });

    it('is a no-op when the file defines no constants', () => {
        const root = resolveScriptVariables(parseHoi4File('x = @A'));
        assert.deepStrictEqual(child(root, 'x').value, { name: '@A' });
    });
});
