import * as assert from 'assert';
import { nodeToString } from '../../hoiformat/tostring';
import { Node } from '../../hoiformat/hoiparser';

describe('hoiformat/tostring', function () {
    function makeNode(partial: Partial<Node>): Node {
        return {
            name: null,
            operator: null,
            value: null,
            valueAttachment: null,
            valueAttachmentToken: null,
            nameToken: null,
            operatorToken: null,
            valueStartToken: null,
            valueEndToken: null,
            ...partial,
        } as Node;
    }

    it('formats string value', function () {
        const n = makeNode({ name: 'key', operator: '=', value: 'hello' });
        assert.strictEqual(nodeToString(n), 'key = "hello"');
    });

    it('formats numeric value', function () {
        const n = makeNode({ name: 'count', operator: '=', value: 7 });
        assert.strictEqual(nodeToString(n), 'count = 7');
    });

    it('formats nested nodes', function () {
        const child = makeNode({ name: 'inner', operator: '=', value: 'val' });
        const n = makeNode({ name: 'outer', operator: '=', value: [child] });
        assert.strictEqual(nodeToString(n), 'outer = { inner = "val" }');
    });

    it('formats with operator only', function () {
        const n = makeNode({ name: 'limit', operator: '>', value: 5 });
        assert.strictEqual(nodeToString(n), 'limit > 5');
    });

    it('formats with valueAttachment', function () {
        const n = makeNode({ name: 'gfx', operator: '=', value: 'test', valueAttachment: { name: 'GFX' } });
        assert.strictEqual(nodeToString(n), 'gfx = GFX "test"');
    });

    it('returns just name when value is null', function () {
        const n = makeNode({ name: 'empty', operator: null, value: null });
        assert.strictEqual(nodeToString(n), 'empty');
    });
});
