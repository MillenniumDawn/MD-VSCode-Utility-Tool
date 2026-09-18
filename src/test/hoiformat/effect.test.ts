import * as assert from 'assert';
import { conditionToString } from '../../hoiformat/condition';
import {
    EffectByCondition,
    EffectComplexExpr,
    EffectItem,
    extractEffectValue,
    findGuardedEffectItems,
    projectEffects,
    RandomListEffect,
} from '../../hoiformat/effect';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { countryScope, Scope } from '../../hoiformat/scope';

// Parses an effect block the way an event option or a decision `complete_effect` reaches the
// evaluator: as the children of the block, in the country scope.
function effectOf(text: string, scope: Scope = countryScope, excludedKeys?: string[]): EffectComplexExpr {
    return extractEffectValue(parseHoi4File(text).value, scope, excludedKeys).effect;
}

function item(effect: EffectComplexExpr): EffectItem {
    assert.ok(effect !== null && 'nodeContent' in effect, `expected a statement, got ${JSON.stringify(effect)}`);
    return effect;
}

function group(effect: EffectComplexExpr): EffectByCondition {
    assert.ok(effect !== null && 'condition' in effect, `expected a guarded group, got ${JSON.stringify(effect)}`);
    return effect;
}

function choice(effect: EffectComplexExpr): RandomListEffect {
    assert.ok(effect !== null && !('condition' in effect) && !('nodeContent' in effect), `expected a random_list, got ${JSON.stringify(effect)}`);
    return effect;
}

function contents(items: EffectComplexExpr[]): string[] {
    return items.map((i) => item(i).nodeContent);
}

describe('hoiformat/effect', function () {
    describe('extractEffectValue', function () {
        it('returns null for an empty block and for a non-block value', function () {
            assert.strictEqual(effectOf(''), null);
            assert.strictEqual(extractEffectValue('yes', countryScope).effect, null);
        });

        it('returns a single statement bare, with its parse node', function () {
            const single = item(effectOf('add_political_power = 10'));
            assert.strictEqual(single.nodeContent, 'add_political_power = 10');
            assert.strictEqual(single.scopeName, '');
            assert.strictEqual(single.node.name, 'add_political_power');
            assert.strictEqual(single.node.value, 10);
        });

        it('groups several statements under an unconditional guard', function () {
            const effect = group(effectOf('add_political_power = 10 add_stability = 0.1'));
            assert.strictEqual(effect.condition, true);
            assert.deepStrictEqual(contents(effect.items), ['add_political_power = 10', 'add_stability = 0.1']);
        });

        it('lets hidden_effect statements join the enclosing group', function () {
            const effect = group(effectOf('add_political_power = 10 hidden_effect = { set_country_flag = my_flag }'));
            assert.strictEqual(effect.condition, true);
            assert.deepStrictEqual(contents(effect.items).sort(), ['add_political_power = 10', 'set_country_flag = my_flag']);
        });

        it('carries the scope a statement was written in and leaves it again', function () {
            const effect = group(effectOf('GER = { add_political_power = 10 } add_stability = 0.1'));
            assert.deepStrictEqual(effect.items.map((i) => item(i).scopeName), ['GER', '']);
        });

        it('names a nested scope after the scope it was entered from', function () {
            const effect = item(effectOf('random_owned_state = { add_extra_state_shared_building_slots = 1 }', { scopeName: 'GER', scopeType: 'country' }));
            assert.strictEqual(effect.scopeName, 'GER.random_owned_state');
        });

        it('guards the body of an if with its limit', function () {
            const effect = group(effectOf('if = { limit = { has_war = yes } add_political_power = 10 }'));
            assert.strictEqual(conditionToString(effect.condition), 'has_war = yes');
            assert.deepStrictEqual(contents(effect.items), ['add_political_power = 10']);
        });

        it('guards an else with the negated limit', function () {
            const effect = group(effectOf('if = { limit = { has_war = yes } add_political_power = 10 else = { add_stability = 0.1 } }'));
            assert.strictEqual(effect.condition, true);
            const [then, otherwise] = effect.items.map(group);
            assert.strictEqual(conditionToString(then!.condition), 'has_war = yes');
            assert.deepStrictEqual(contents(then!.items), ['add_political_power = 10']);
            assert.strictEqual(conditionToString(otherwise!.condition), 'ornot(has_war = yes)');
            assert.deepStrictEqual(contents(otherwise!.items), ['add_stability = 0.1']);
        });

        it('guards each else_if with the limits before it negated', function () {
            const text = 'if = { limit = { a = yes } x = 1 else_if = { limit = { b = yes } y = 1 } else = { z = 1 } }';
            const branches = group(effectOf(text)).items.map(group);
            assert.deepStrictEqual(branches.map((b) => conditionToString(b.condition)), [
                'a = yes',
                'and(ornot(a = yes), b = yes)',
                'and(ornot(a = yes), ornot(b = yes))',
            ]);
            assert.deepStrictEqual(branches.map((b) => contents(b.items)), [['x = 1'], ['y = 1'], ['z = 1']]);
        });

        it('reads else_if and else written as siblings of the if', function () {
            const text = 'if = { limit = { a = yes } x = 1 } else_if = { limit = { b = yes } y = 1 } else = { z = 1 }';
            const branches = group(effectOf(text)).items.map(group);
            assert.deepStrictEqual(branches.map((b) => conditionToString(b.condition)), [
                'a = yes',
                'and(ornot(a = yes), b = yes)',
                'and(ornot(a = yes), ornot(b = yes))',
            ]);
        });

        it('folds an enclosing if into a nested one', function () {
            const effect = group(effectOf('if = { limit = { a = yes } if = { limit = { b = yes } x = 1 } }'));
            assert.strictEqual(conditionToString(effect.condition), 'and(a = yes, b = yes)');
            assert.deepStrictEqual(contents(effect.items), ['x = 1']);
        });

        it('drops an if without a limit and an else without an if', function () {
            assert.strictEqual(effectOf('if = { x = 1 }'), null);
            assert.strictEqual(effectOf('else = { x = 1 }'), null);
        });

        it('ignores an else_if or else that is not a block', function () {
            const effect = group(effectOf('if = { limit = { a = yes } x = 1 else_if = yes else = no }'));
            assert.strictEqual(conditionToString(effect.condition), 'a = yes');
            assert.deepStrictEqual(contents(effect.items), ['x = 1']);
        });

        it('keeps every weighted branch of a random_list', function () {
            const effect = choice(effectOf('random_list = { 30 = { x = 1 } 70 = { y = 1 } }'));
            assert.deepStrictEqual(effect.items.map((i) => i.possibility), [30, 70]);
            assert.deepStrictEqual(effect.items.map((i) => item(i.effect).nodeContent), ['x = 1', 'y = 1']);
        });

        it('does not read a branch modifier as an effect', function () {
            const effect = choice(effectOf('random_list = { 50 = { modifier = { factor = 2 has_war = yes } x = 1 } 50 = { y = 1 } }'));
            assert.strictEqual(item(effect.items[0]!.effect).nodeContent, 'x = 1');
        });

        it('drops a branch with no weight and unwraps the one left', function () {
            const effect = item(effectOf('random_list = { 0 = { x = 1 } 50 = { y = 1 } }'));
            assert.strictEqual(effect.nodeContent, 'y = 1');
            assert.strictEqual(effectOf('random_list = { 0 = { x = 1 } }'), null);
        });

        // A random_list picks one branch; it does not lift the if around it. Without this the
        // effects inside read as unconditional.
        it('keeps an enclosing if on every random_list branch', function () {
            const effect = choice(effectOf('if = { limit = { a = yes } random_list = { 50 = { x = 1 } 50 = { y = 1 } } }'));
            for (const branch of effect.items) {
                const guarded = group(branch.effect);
                assert.strictEqual(conditionToString(guarded.condition), 'a = yes');
            }
            assert.deepStrictEqual(effect.items.map((i) => contents(group(i.effect).items)), [['x = 1'], ['y = 1']]);
        });

        it('skips the excluded keys at the top level only', function () {
            const effect = item(effectOf('name = my_option add_political_power = 10', countryScope, ['name']));
            assert.strictEqual(effect.nodeContent, 'add_political_power = 10');
            const nested = item(effectOf('GER = { name = my_option }', countryScope, ['name']));
            assert.strictEqual(nested.nodeContent, 'name = my_option');
        });
    });

    describe('projectEffects', function () {
        it('projects nothing for null', function () {
            assert.deepStrictEqual(projectEffects(null), []);
        });

        it('projects a statement to a line without its parse node', function () {
            assert.deepStrictEqual(projectEffects(effectOf('GER = { add_political_power = 10 }')), [
                { kind: 'line', scopeName: 'GER', content: 'add_political_power = 10' },
            ]);
        });

        it('unwraps an unconditional group and keeps a guarded one', function () {
            assert.deepStrictEqual(projectEffects(effectOf('x = 1 y = 2')), [
                { kind: 'line', scopeName: '', content: 'x = 1' },
                { kind: 'line', scopeName: '', content: 'y = 2' },
            ]);
            const guarded = projectEffects(effectOf('if = { limit = { a = yes } x = 1 }'));
            assert.strictEqual(guarded.length, 1);
            const only = guarded[0]!;
            assert.strictEqual(only.kind, 'group');
            if (only.kind === 'group') {
                assert.strictEqual(conditionToString(only.condition), 'a = yes');
                assert.deepStrictEqual(only.items, [{ kind: 'line', scopeName: '', content: 'x = 1' }]);
            }
        });

        it('drops a group and a choice with nothing inside', function () {
            assert.deepStrictEqual(projectEffects({ condition: true, items: [null] }), []);
            assert.deepStrictEqual(projectEffects({ condition: { scopeName: '', nodeContent: 'a = yes' }, items: [] }), []);
            assert.deepStrictEqual(projectEffects({ items: [{ possibility: 50, effect: null }] }), []);
        });

        it('projects a random_list to a weighted choice', function () {
            assert.deepStrictEqual(projectEffects(effectOf('random_list = { 30 = { x = 1 } 70 = { y = 1 } 0 = { z = 1 } }')), [
                {
                    kind: 'choice',
                    items: [
                        { possibility: 30, effect: [{ kind: 'line', scopeName: '', content: 'x = 1' }] },
                        { possibility: 70, effect: [{ kind: 'line', scopeName: '', content: 'y = 1' }] },
                    ],
                },
            ]);
        });
    });

    describe('findGuardedEffectItems', function () {
        it('finds statements by name regardless of case', function () {
            const effect = effectOf('Country_Event = { id = my.1 } add_political_power = 10 news_event = my.2');
            const found = findGuardedEffectItems(effect, ['country_event', 'news_event']);
            assert.deepStrictEqual(found.map((f) => f.item.nodeContent), ['Country_Event = { id = my.1 }', 'news_event = my.2']);
            assert.deepStrictEqual(found.map((f) => f.condition), [true, true]);
            assert.deepStrictEqual(found.map((f) => f.possibility), [undefined, undefined]);
        });

        it('finds nothing in null and a statement with another name', function () {
            assert.deepStrictEqual(findGuardedEffectItems(null, ['country_event']), []);
            assert.deepStrictEqual(findGuardedEffectItems(effectOf('add_political_power = 10'), ['country_event']), []);
        });

        it('carries the guard of every if around a statement', function () {
            const effect = effectOf('if = { limit = { a = yes } country_event = my.1 if = { limit = { b = yes } country_event = my.2 } }');
            const found = findGuardedEffectItems(effect, ['country_event']);
            assert.deepStrictEqual(
                found.map((f) => [f.item.nodeContent, conditionToString(f.condition)]).sort(),
                [
                    ['country_event = my.1', 'a = yes'],
                    ['country_event = my.2', 'and(a = yes, b = yes)'],
                ],
            );
        });

        it('carries the weight of a random_list branch and its enclosing guard once', function () {
            const effect = effectOf('if = { limit = { a = yes } random_list = { 30 = { country_event = my.1 } 70 = { x = 1 } } }');
            const found = findGuardedEffectItems(effect, ['country_event']);
            assert.strictEqual(found.length, 1);
            assert.strictEqual(found[0]!.possibility, 30);
            assert.strictEqual(conditionToString(found[0]!.condition), 'a = yes');
        });

        it('does not state a guard it was given twice', function () {
            const effect = effectOf('if = { limit = { a = yes } country_event = my.1 }');
            const found = findGuardedEffectItems(effect, ['country_event'], { scopeName: '', nodeContent: 'a = yes' });
            assert.strictEqual(conditionToString(found[0]!.condition), 'a = yes');
        });

        it('appends to and returns the array it was given', function () {
            const result = findGuardedEffectItems(effectOf('country_event = my.1'), ['country_event']);
            const returned = findGuardedEffectItems(effectOf('country_event = my.2'), ['country_event'], true, undefined, result);
            assert.strictEqual(returned, result);
            assert.deepStrictEqual(result.map((f) => f.item.nodeContent), ['country_event = my.1', 'country_event = my.2']);
        });
    });
});
