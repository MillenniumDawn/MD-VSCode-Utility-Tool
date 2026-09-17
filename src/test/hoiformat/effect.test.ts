import * as assert from 'assert';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { extractEffectValue, projectEffects } from '../../hoiformat/effect';
import { countryScope } from '../../hoiformat/scope';
import { EffectTreeNode } from '../../previewdef/sharedpayload';

function project(text: string): EffectTreeNode[] {
    const root = parseHoi4File(text);
    return projectEffects(extractEffectValue(root.value, countryScope).effect);
}

function lines(nodes: EffectTreeNode[]): string[] {
    return nodes.map(n => n.kind === 'line' ? n.content : n.kind);
}

describe('hoiformat/effect', function () {
    describe('extractEffectValue', function () {
        it('merges statements that share a condition into one group, in source order', function () {
            // hidden_effect blocks and the plain statements around them all carry the same
            // (unconditional) guard, so they land in one group however they are interleaved.
            const nodes = project([
                'a = 1',
                'hidden_effect = { b = 2 }',
                'c = 3',
                'hidden_effect = { d = 4 }',
            ].join('\n'));

            assert.deepStrictEqual(lines(nodes), ['b = 2', 'd = 4', 'a = 1', 'c = 3']);
        });

        it('keeps statements under different limits in different groups', function () {
            const nodes = project([
                'if = { limit = { tag = GER } a = 1 }',
                'if = { limit = { tag = FRA } b = 2 }',
                'c = 3',
            ].join('\n'));

            assert.deepStrictEqual(lines(nodes), ['group', 'group', 'c = 3']);
            const [first, second] = nodes as Extract<EffectTreeNode, { kind: 'group' }>[];
            assert.deepStrictEqual(lines(first!.items), ['a = 1']);
            assert.deepStrictEqual(lines(second!.items), ['b = 2']);
        });

        it('merges a second block under the same condition object into the first group', function () {
            // The else of an if and the next if share nothing; but two hidden_effect blocks inside
            // one if share the if's condition object, so their statements join one group.
            const nodes = project([
                'if = {',
                '    limit = { tag = GER }',
                '    hidden_effect = { a = 1 }',
                '    hidden_effect = { b = 2 }',
                '}',
            ].join('\n'));

            assert.deepStrictEqual(lines(nodes), ['group']);
            const [group] = nodes as Extract<EffectTreeNode, { kind: 'group' }>[];
            assert.deepStrictEqual(lines(group!.items), ['a = 1', 'b = 2']);
        });
    });
});
