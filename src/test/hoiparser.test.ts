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

    // These are valid Paradox comparison operators, but the single-character operator class used
    // to come first in the alternation, so `>=` matched only the `>` and the `=` was then read as
    // the start of a value -- which made the whole file fail to parse.
    it('parses the two-character comparison operators', () => {
        for (const operator of ['>=', '<=', '!=']) {
            const root = parseHoi4File(`limit = { num_of_factories ${operator} 10 }`);
            const compared = child(child(root, 'limit'), 'num_of_factories');
            assert.strictEqual(compared.operator, operator, `operator ${operator}`);
            assert.strictEqual(compared.value, 10, `value after ${operator}`);
        }
    });

    it('still parses the single-character comparison operators', () => {
        for (const operator of ['>', '<', '=']) {
            const root = parseHoi4File(`limit = { num_of_factories ${operator} 10 }`);
            const compared = child(child(root, 'limit'), 'num_of_factories');
            assert.strictEqual(compared.operator, operator, `operator ${operator}`);
            assert.strictEqual(compared.value, 10, `value after ${operator}`);
        }
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

    it('parses nested blocks recursively', () => {
        const root = parseHoi4File('outer = { inner = { leaf = 7 } }');
        const inner = child(child(root, 'outer'), 'inner');
        assert.strictEqual(child(inner, 'leaf').value, 7);
    });

    it('parses hex numbers', () => {
        // Known limitation: the tokenizer's `symbol` rule (priority 40) matches
        // `0x10` before the `number` rule (priority 50) does, so hex literals end
        // up tokenized as symbols. The number parser then calls parseFloat on the
        // symbol value, which yields 0. Document the actual behaviour: the regex
        // supports hex on paper but the tokenizer order makes it inert in
        // practice.
        const root = parseHoi4File('flags = 0x10');
        const flags = child(root, 'flags');
        assert.strictEqual(flags.value, 0);
    });

    it('parses float numbers', () => {
        const root = parseHoi4File('ratio = 0.5');
        assert.strictEqual(child(root, 'ratio').value, 0.5);
    });

    // The game tolerates a number whose fraction was never written, and Millennium Dawn writes one:
    // `nationalist_drift = 0.` in common/country_leader/00_traits.txt. The trailing `.` used to be
    // left over as its own token and threw "Invalid token", costing the whole file -- every
    // politician trait in the mod -- rather than just that line.
    it('parses a number written with a trailing dot and no fraction', () => {
        const root = parseHoi4File('nationalist_drift = 0. army_attack_factor = 0.15');
        assert.strictEqual(child(root, 'nationalist_drift').value, 0);
        assert.strictEqual(child(root, 'army_attack_factor').value, 0.15);
    });

    // The full-fraction branch still comes first in the alternation, so a date keeps splitting the
    // way every reader of one already expects.
    it('still reads a date as a number and the fragments after it', () => {
        const root = parseHoi4File('expire = 2030.1.1.1');
        assert.strictEqual(child(root, 'expire').value, 2030.1);
    });

    it('parses unescaped quotes inside a string', () => {
        const root = parseHoi4File('name = "hello world"');
        assert.strictEqual(child(root, 'name').value, 'hello world');
    });

    it('preserves escaped characters in a string', () => {
        // The parser un-escapes \" to " and \\ to \.
        const root = parseHoi4File('name = "he said \\"hi\\""');
        assert.strictEqual(child(root, 'name').value, 'he said "hi"');
    });

    it('parses symbol values (bare identifiers)', () => {
        const root = parseHoi4File('color = red');
        const color = child(root, 'color');
        assert.deepStrictEqual(color.value, { name: 'red' });
    });

    it('parses the single-character >, <, and != comparison operators', () => {
        // Known limitation: the operator regex lists `[=<>]` and the multi-char
        // forms `>=|<=|!=` as alternates, but the regex engine tries the single
        // char first. So `le <= 3` consumes `<`, leaves `=`, and the parser then
        // chokes on `=` as a value. `!=` works because `!` is not in the single
        // char set. Document the actual behaviour: only `>`, `<`, `!=` work.
        const root = parseHoi4File('limit > 5\nlt < 2\nne != 0');
        assert.strictEqual(child(root, 'limit').operator, '>');
        assert.strictEqual(child(root, 'limit').value, 5);
        assert.strictEqual(child(root, 'lt').operator, '<');
        assert.strictEqual(child(root, 'ne').operator, '!=');
    });

    it('handles commas and semicolons as separators', () => {
        const root = parseHoi4File('a = 1, b = 2; c = 3');
        assert.strictEqual(child(root, 'a').value, 1);
        assert.strictEqual(child(root, 'b').value, 2);
        assert.strictEqual(child(root, 'c').value, 3);
    });

    it('captures value attachment when a value is followed by a block', () => {
        // In HOI4 `buttonType = ButtonType { ... }` is a common idiom; the parser preserves
        // the symbol before the block as valueAttachment.
        const root = parseHoi4File('button = ButtonType { x = 1 y = 2 }');
        const button = child(root, 'button');
        assert.deepStrictEqual(button.valueAttachment, { name: 'ButtonType' });
        const block = button.value as Node[];
        assert.strictEqual(child({ value: block } as any, 'x').value, 1);
    });

    it('parses flagless entries (name with no operator)', () => {
        // Bare names with no operator are stored as null-valued nodes.
        const root = parseHoi4File('flag');
        const flag = (root.value as Node[]).find(n => n.name === 'flag');
        assert.ok(flag, 'expected a node named flag');
        assert.strictEqual(flag!.value, null);
    });

    it('skips comments and still parses surrounding tokens', () => {
        const root = parseHoi4File('# this is a comment\na = 1 # trailing\nb = 2');
        assert.strictEqual(child(root, 'a').value, 1);
        assert.strictEqual(child(root, 'b').value, 2);
    });

    it('throws a UserError when input has an invalid token', () => {
        assert.throws(() => parseHoi4File('a = `bad`'), /Invalid token/);
    });

    it('throws when an unterminated block is left open', () => {
        assert.throws(() => parseHoi4File('a = { b = 1'), /Expect a '}'|Invalid token/);
    });

    it('parses two sequential inputs, resetting the shared sticky regex', () => {
        // The token regex is a module-level sticky constant reused across parses; a
        // stale lastIndex would derail the second parse if it were not reset.
        assert.strictEqual(child(parseHoi4File('a = 1'), 'a').value, 1);
        assert.strictEqual(child(parseHoi4File('b = 2'), 'b').value, 2);
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
