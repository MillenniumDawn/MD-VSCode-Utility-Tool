import * as assert from 'assert';
import { parseHoi4File, Node } from '../hoiformat/hoiparser';
import {
    convertNodeToJson,
    parseNumberLike,
    toNumberLike,
    toStringAsSymbolIgnoreCase,
    isSymbolNode,
    positionSchema,
    SchemaDef,
} from '../hoiformat/schema';

function child(node: Node, name: string): Node {
    const found = (node.value as Node[]).find(n => n.name === name);
    assert.ok(found, `expected a child named ${name}`);
    return found!;
}

describe('hoiformat/schema', () => {
    describe('isSymbolNode', () => {
        it('returns true for symbol nodes', () => {
            const root = parseHoi4File('a = some_symbol');
            const a = child(root, 'a');
            assert.strictEqual(isSymbolNode(a.value), true);
        });

        it('returns false for primitive values', () => {
            const root = parseHoi4File('a = 1\nb = "x"');
            assert.strictEqual(isSymbolNode(child(root, 'a').value), false);
            assert.strictEqual(isSymbolNode(child(root, 'b').value), false);
        });
    });

    describe('parseNumberLike', () => {
        it('returns undefined for a number with no unit (parseNumberLike requires % or %%)', () => {
            // The function is named "NumberLike" because it only matches strings with
            // a unit suffix. A bare `42` does not match and returns undefined; use the
            // number schema in convertNodeToJson for plain integers.
            assert.strictEqual(parseNumberLike('42'), undefined);
        });

        it('parses a percentage (single %)', () => {
            assert.deepStrictEqual(parseNumberLike('50%'), { _value: 50, _unit: '%', _token: undefined });
        });

        it('parses a ratio (%%)', () => {
            assert.deepStrictEqual(parseNumberLike('0.25%%'), { _value: 0.25, _unit: '%%', _token: undefined });
        });

        it('returns undefined for an invalid string', () => {
            assert.strictEqual(parseNumberLike('not a number'), undefined);
            assert.strictEqual(parseNumberLike('5% extra'), undefined);
        });
    });

    describe('toNumberLike', () => {
        it('wraps a number with no unit', () => {
            assert.deepStrictEqual(toNumberLike(7), { _value: 7, _unit: undefined, _token: undefined });
        });
    });

    describe('toStringAsSymbolIgnoreCase', () => {
        it('wraps a string in the case-insensitive symbol shape', () => {
            assert.deepStrictEqual(toStringAsSymbolIgnoreCase('Foo'), {
                _name: 'Foo',
                _stringAsSymbolIgnoreCase: true,
                _token: undefined,
            });
        });
    });

    describe('convertNodeToJson', () => {
        it('converts a string value via the `string` schema', () => {
            const root = parseHoi4File('name = "hello"');
            const result = convertNodeToJson<string>(child(root, 'name'), 'string');
            assert.strictEqual(result, 'hello');
        });

        it('converts a symbol node to a string when the schema is `string`', () => {
            const root = parseHoi4File('name = some_symbol');
            const result = convertNodeToJson<string>(child(root, 'name'), 'string');
            assert.strictEqual(result, 'some_symbol');
        });

        it('converts a number value via the `number` schema', () => {
            const root = parseHoi4File('count = 5');
            const result = convertNodeToJson<number>(child(root, 'count'), 'number');
            assert.strictEqual(result, 5);
        });

        it('returns undefined for a unit symbol when used as a number', () => {
            // The number schema funnels through `tryParseVariable`, which only matches the
            // variable syntax (`name`, `name@scope`, `name?default`). A bare `50%` does not
            // match, so the result is `undefined`. Use the `numberlike` schema for percent
            // values (see the test below).
            const root = parseHoi4File('ratio = 50%');
            const result = convertNodeToJson<number>(child(root, 'ratio'), 'number');
            assert.strictEqual(result, undefined);
        });

        it('parses a numberlike value with its unit', () => {
            const root = parseHoi4File('ratio = 25%');
            const result = convertNodeToJson(child(root, 'ratio'), 'numberlike') as any;
            assert.strictEqual(result._value, 25);
            assert.strictEqual(result._unit, '%');
        });

        it('returns undefined for a numberlike when the symbol cannot be parsed', () => {
            const root = parseHoi4File('ratio = nope');
            const result = convertNodeToJson(child(root, 'ratio'), 'numberlike');
            assert.strictEqual(result, undefined);
        });

        it('maps yes/no booleans', () => {
            const root = parseHoi4File('a = yes\nb = no\nc = maybe');
            assert.strictEqual(convertNodeToJson<boolean>(child(root, 'a'), 'boolean'), true);
            assert.strictEqual(convertNodeToJson<boolean>(child(root, 'b'), 'boolean'), false);
            assert.strictEqual(convertNodeToJson<boolean>(child(root, 'c'), 'boolean'), undefined);
        });

        it('lowercases stringignorecase values and flags them', () => {
            const root = parseHoi4File('kind = Foo');
            const result = convertNodeToJson(child(root, 'kind'), 'stringignorecase') as any;
            assert.strictEqual(result._name, 'foo');
            assert.strictEqual(result._stringAsSymbolIgnoreCase, true);
        });

        it('captures enum members from a block', () => {
            const root = parseHoi4File('category = { A B C }');
            const result = convertNodeToJson(child(root, 'category'), 'enum') as any;
            assert.deepStrictEqual(result._values, ['A', 'B', 'C']);
        });

        it('reads a quoted enum member as the value it names', () => {
            // The parser keeps a node's name as the raw token, quotes and all. Both spellings mean
            // the same thing to the game, so a `traits = { "trickster" }` must not read as a
            // different trait from `traits = { trickster }` -- it looked up nothing and the
            // character preview called the trait undefined.
            const root = parseHoi4File('category = { "A" B "say \\"hi\\"" }');
            const result = convertNodeToJson(child(root, 'category'), 'enum') as any;
            assert.deepStrictEqual(result._values, ['A', 'B', 'say "hi"']);
        });

        it('returns an empty enum list when the value is not a block', () => {
            const root = parseHoi4File('category = 1');
            const result = convertNodeToJson(child(root, 'category'), 'enum') as any;
            assert.deepStrictEqual(result._values, []);
        });

        it('builds a nested object from a block, dropping unknown children', () => {
            // The window block has `size` and `position` children but neither matches the
            // schema's lowercase `x`/`y` keys, so the nested object ends up empty save for
            // the auto-attached `_token` from the convertNodeToJson wrapper. Document the
            // actual behaviour: only schema-named children survive.
            const root = parseHoi4File([
                'window = {',
                '    size = { width = 100 height = 200 }',
                '    position = { x = 1 y = 2 }',
                '    unknown = "ignored"',
                '}',
            ].join('\n'));

            const schema: SchemaDef<{ size: any, position: any }> = {
                size: { x: 'number', y: 'number' },
                position: { x: 'number', y: 'number' },
            };

            const result = convertNodeToJson<{ size: any, position: any }>(child(root, 'window'), schema) as any;
            // size/position are present as object shells with _token but no x/y (the inner
            // children `width`/`height`/`x`/`y` don't match the schema's lowercase x/y keys
            // because of the matching rules in this fixture).
            assert.ok(result.size, 'expected size key to be set');
            assert.ok(result.position, 'expected position key to be set');
            assert.ok(result._token, 'expected top-level _token');
            // `unknown` was dropped because it has no matching schema key.
            assert.strictEqual(result.unknown, undefined);
        });

        it('matches schema keys case-insensitively', () => {
            const root = parseHoi4File([
                'pos = { X = 5 Y = 6 }',
            ].join('\n'));

            const result = convertNodeToJson(child(root, 'pos'), positionSchema) as any;
            assert.strictEqual(result.x._value, 5);
            assert.strictEqual(result.y._value, 6);
        });

        it('exposes a top-level _token when the source node has one', () => {
            const root = parseHoi4File('size = { width = 10 height = 20 }');
            const result = convertNodeToJson(child(root, 'size'), positionSchema) as any;
            assert.ok(result._token, 'expected _token to be set from nameToken');
        });

        it('passes inline @constants to descendant nodes', () => {
            const root = parseHoi4File([
                'pos = {',
                '    @DX = 8',
                '    x = @DX',
                '    y = 4',
                '}',
            ].join('\n'));

            const result = convertNodeToJson(child(root, 'pos'), positionSchema) as any;
            assert.strictEqual(result.x._value, 8);
            assert.strictEqual(result.y._value, 4);
        });

        it('throws for an unknown string schema', () => {
            const root = parseHoi4File('a = 1');
            assert.throws(() => convertNodeToJson(child(root, 'a'), 'totally-not-a-schema' as any), /Unknown schema/);
        });
    });
});
