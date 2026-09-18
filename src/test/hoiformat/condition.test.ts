import * as assert from 'assert';
import {
    andCondition,
    applyCondition,
    ConditionAmountFolder,
    ConditionComplexExpr,
    ConditionFolder,
    ConditionItem,
    conditionToString,
    extractConditionalExprs,
    extractConditionFolder,
    extractConditionValue,
    extractConditionValues,
    simplifyCondition,
} from '../../hoiformat/condition';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { countryScope, Scope } from '../../hoiformat/scope';

function leaf(nodeContent: string, scopeName: string = ''): ConditionItem {
    return { scopeName, nodeContent };
}

function folder(type: ConditionFolder['type'], ...items: ConditionComplexExpr[]): ConditionFolder {
    return { type, items };
}

function count(amount: number, ...items: ConditionComplexExpr[]): ConditionAmountFolder {
    return { type: 'count', amount, items };
}

// Parses a trigger block the way a focus `available = { ... }` or an event `trigger = { ... }`
// reaches the evaluator: as the children of the block, in the country scope.
function triggers(text: string, scope: Scope = countryScope): ConditionFolder | ConditionAmountFolder {
    return extractConditionFolder(parseHoi4File(text).value, [scope]);
}

// Evaluates a trigger block with the given lines held true; every other leaf is false.
function evaluate(text: string, trueLines: string[]): boolean {
    return applyCondition(simplifyCondition(triggers(text)), trueLines.map((line) => leaf(line)));
}

const a = leaf('a = yes');
const b = leaf('b = yes');
const c = leaf('c = yes');

describe('hoiformat/condition', function () {
    describe('simplifyCondition', function () {
        it('passes booleans and leaves through unchanged', function () {
            assert.strictEqual(simplifyCondition(true), true);
            assert.strictEqual(simplifyCondition(false), false);
            assert.strictEqual(simplifyCondition(a), a);
        });

        it('collapses an and folder holding a false item to false', function () {
            assert.strictEqual(simplifyCondition(folder('and', a, false, b)), false);
        });

        it('drops true items from an and folder', function () {
            assert.strictEqual(conditionToString(simplifyCondition(folder('and', true, a, true, b))), 'and(a = yes, b = yes)');
        });

        it('turns an and folder of only true items into true', function () {
            assert.strictEqual(simplifyCondition(folder('and', true, true)), true);
            assert.strictEqual(simplifyCondition(folder('and')), true);
        });

        it('returns the only remaining item of an and or or folder bare', function () {
            assert.strictEqual(simplifyCondition(folder('and', true, a)), a);
            assert.strictEqual(simplifyCondition(folder('or', false, a)), a);
        });

        it('collapses an or folder holding a true item to true', function () {
            assert.strictEqual(simplifyCondition(folder('or', a, true, b)), true);
        });

        it('drops false items from an or folder and turns an all-false one into false', function () {
            assert.strictEqual(conditionToString(simplifyCondition(folder('or', false, a, b))), 'or(a = yes, b = yes)');
            assert.strictEqual(simplifyCondition(folder('or', false, false)), false);
            assert.strictEqual(simplifyCondition(folder('or')), false);
        });

        // NOT { a b } is ornot(a, b): none of them may hold.
        it('collapses an ornot folder holding a true item to false and an empty one to true', function () {
            assert.strictEqual(simplifyCondition(folder('ornot', a, true)), false);
            assert.strictEqual(simplifyCondition(folder('ornot', false, false)), true);
            assert.strictEqual(simplifyCondition(folder('ornot')), true);
        });

        // andnot(a, b) is the negation of an and folder: it holds when any item fails.
        it('collapses an andnot folder holding a false item to true and an empty one to false', function () {
            assert.strictEqual(simplifyCondition(folder('andnot', a, false)), true);
            assert.strictEqual(simplifyCondition(folder('andnot', true, true)), false);
            assert.strictEqual(simplifyCondition(folder('andnot')), false);
        });

        it('rewrites a single-item andnot as ornot', function () {
            assert.strictEqual(conditionToString(simplifyCondition(folder('andnot', true, a))), 'ornot(a = yes)');
        });

        it('cancels a double negation', function () {
            assert.strictEqual(conditionToString(simplifyCondition(folder('ornot', folder('ornot', a, b)))), 'or(a = yes, b = yes)');
            assert.strictEqual(conditionToString(simplifyCondition(folder('ornot', folder('andnot', a, b)))), 'and(a = yes, b = yes)');
        });

        it('keeps a multi-item ornot folder as it is', function () {
            assert.strictEqual(conditionToString(simplifyCondition(folder('ornot', a, b))), 'ornot(a = yes, b = yes)');
        });

        it('lowers the amount of a count folder for every item already true', function () {
            assert.strictEqual(conditionToString(simplifyCondition(count(2, true, a, b))), 'count(a = yes, b = yes) == 1');
        });

        it('turns a count folder into true once enough items are true', function () {
            assert.strictEqual(simplifyCondition(count(1, true, a)), true);
            assert.strictEqual(simplifyCondition(count(0, a, b)), true);
        });

        it('turns a count folder into false when fewer items remain than are needed', function () {
            assert.strictEqual(simplifyCondition(count(3, a, false, b)), false);
        });

        it('turns a count folder needing every remaining item into an and folder', function () {
            assert.strictEqual(conditionToString(simplifyCondition(count(2, a, b, false))), 'and(a = yes, b = yes)');
            assert.strictEqual(simplifyCondition(count(1, a, false)), a);
        });

        it('simplifies nested folders recursively', function () {
            const nested = folder('and', a, folder('or', b, folder('and', c, true)), folder('and', true));
            assert.strictEqual(conditionToString(simplifyCondition(nested)), 'and(a = yes, or(b = yes, c = yes))');
        });
    });

    describe('applyCondition', function () {
        it('returns a boolean condition as it is', function () {
            assert.strictEqual(applyCondition(true, []), true);
            assert.strictEqual(applyCondition(false, [a]), false);
        });

        it('holds a leaf true only when the same scope and content is in the true list', function () {
            assert.strictEqual(applyCondition(a, [a]), true);
            assert.strictEqual(applyCondition(a, [b]), false);
            assert.strictEqual(applyCondition(leaf('a = yes', 'GER'), [a]), false);
            assert.strictEqual(applyCondition(leaf('a = yes', 'GER'), [leaf('a = yes', 'GER')]), true);
        });

        // The four folder types against every assignment of two leaves. A wrong short-circuit in
        // the switch shows the wrong focus-tree branch as if it were right, so the whole table is
        // checked rather than one case per type.
        const table: { type: ConditionFolder['type']; expected: (x: boolean, y: boolean) => boolean }[] = [
            { type: 'and', expected: (x, y) => x && y },
            { type: 'or', expected: (x, y) => x || y },
            { type: 'andnot', expected: (x, y) => !(x && y) },
            { type: 'ornot', expected: (x, y) => !(x || y) },
        ];
        for (const { type, expected } of table) {
            it(`evaluates ${type} over every assignment of two leaves`, function () {
                for (const x of [false, true]) {
                    for (const y of [false, true]) {
                        const trueExprs = [...(x ? [a] : []), ...(y ? [b] : [])];
                        assert.strictEqual(applyCondition(folder(type, a, b), trueExprs), expected(x, y), `${type}(${x}, ${y})`);
                    }
                }
            });
        }

        it('evaluates an empty folder to its identity', function () {
            assert.strictEqual(applyCondition(folder('and'), []), true);
            assert.strictEqual(applyCondition(folder('or'), []), false);
            assert.strictEqual(applyCondition(folder('andnot'), []), false);
            assert.strictEqual(applyCondition(folder('ornot'), []), true);
        });

        it('holds a count folder when at least the amount of items hold', function () {
            assert.strictEqual(applyCondition(count(2, a, b, c), [a, c]), true);
            assert.strictEqual(applyCondition(count(2, a, b, c), [a, b, c]), true);
            assert.strictEqual(applyCondition(count(2, a, b, c), [b]), false);
        });

        it('evaluates nested folders', function () {
            const nested = folder('and', a, folder('or', b, c));
            assert.strictEqual(applyCondition(nested, [a, c]), true);
            assert.strictEqual(applyCondition(nested, [a]), false);
            assert.strictEqual(applyCondition(nested, [b, c]), false);
        });

        // The true list's keys are cached against the array and rebuilt when its length changes.
        // (Swapping one leaf for another without changing the length is not noticed; the webviews
        // build a new array per selection, so they never do that.)
        it('sees a true list that grew or shrank after the first evaluation', function () {
            const trueExprs: ConditionItem[] = [];
            assert.strictEqual(applyCondition(a, trueExprs), false);
            trueExprs.push(a);
            assert.strictEqual(applyCondition(a, trueExprs), true);
            trueExprs.push(b);
            assert.strictEqual(applyCondition(folder('and', a, b), trueExprs), true);
            trueExprs.shift();
            assert.strictEqual(applyCondition(a, trueExprs), false);
            assert.strictEqual(applyCondition(b, trueExprs), true);
        });
    });

    describe('andCondition', function () {
        it('returns the other operand unchanged when one side is true', function () {
            const or = folder('or', a, b);
            assert.strictEqual(andCondition(true, or), or);
            assert.strictEqual(andCondition(or, true), or);
            assert.strictEqual(andCondition(true, true), true);
        });

        it('returns false when either side is false', function () {
            assert.strictEqual(andCondition(false, a), false);
            assert.strictEqual(andCondition(a, false), false);
        });

        it('combines two leaves into one and folder', function () {
            assert.strictEqual(conditionToString(andCondition(a, b)), 'and(a = yes, b = yes)');
        });

        it('flattens nested and folders', function () {
            const combined = andCondition(folder('and', a, b), folder('and', c, folder('and', leaf('d = yes'))));
            assert.strictEqual(conditionToString(combined), 'and(a = yes, b = yes, c = yes, d = yes)');
        });

        it('drops a true item found inside a folder it flattens', function () {
            assert.strictEqual(conditionToString(andCondition(folder('and', true, a), b)), 'and(a = yes, b = yes)');
        });

        // An enclosing `if` is folded into a `random_list` branch and then folded again while the
        // calls inside it are collected; the guard has to show once.
        it('keeps an item that both sides carry once', function () {
            assert.strictEqual(andCondition(a, a), a);
            assert.strictEqual(conditionToString(andCondition(folder('and', a, b), a)), 'and(a = yes, b = yes)');
            const or = folder('or', a, b);
            assert.strictEqual(conditionToString(andCondition(or, folder('and', c, folder('or', a, b)))), 'and(or(a = yes, b = yes), c = yes)');
        });

        it('keeps folders that differ', function () {
            assert.strictEqual(conditionToString(andCondition(folder('or', a, b), folder('or', a, c))), 'and(or(a = yes, b = yes), or(a = yes, c = yes))');
        });
    });

    describe('extractConditionalExprs', function () {
        it('collects the leaves of every folder type and skips booleans', function () {
            const condition = folder('and', a, folder('or', b, true), folder('ornot', c), count(1, leaf('d = yes'), false));
            assert.deepStrictEqual(extractConditionalExprs(condition), [a, b, c, leaf('d = yes')]);
            assert.deepStrictEqual(extractConditionalExprs(true), []);
        });

        it('keeps each leaf once', function () {
            const condition = folder('or', a, folder('and', a, b), leaf('a = yes', 'GER'));
            assert.deepStrictEqual(extractConditionalExprs(condition), [a, b, leaf('a = yes', 'GER')]);
        });

        it('appends to and returns the accumulator it was given', function () {
            const result = [a];
            const returned = extractConditionalExprs(folder('and', a, b), result);
            assert.strictEqual(returned, result);
            assert.deepStrictEqual(result, [a, b]);
            extractConditionalExprs(folder('or', b, c), result);
            assert.deepStrictEqual(result, [a, b, c]);
        });
    });

    describe('extractConditionFolder', function () {
        it('turns flat triggers into leaves in the given scope', function () {
            const scoped = triggers('has_war = yes num_of_factories > 10', { scopeName: 'GER', scopeType: 'country' });
            assert.deepStrictEqual(scoped, folder('and', leaf('has_war = yes', 'GER'), leaf('num_of_factories > 10', 'GER')));
        });

        it('returns an empty folder for a non-block value', function () {
            assert.deepStrictEqual(extractConditionFolder('yes', [countryScope]), folder('and'));
            assert.deepStrictEqual(extractConditionFolder(null, [countryScope], 'count', undefined, 2), count(2));
        });

        it('maps AND, OR, NOT and hidden_trigger blocks regardless of case', function () {
            const parsed = triggers('AND = { a = yes } Or = { b = yes } not = { c = yes } hidden_trigger = { d = yes }');
            assert.strictEqual(conditionToString(parsed), 'and(and(a = yes), or(b = yes), ornot(c = yes), and(d = yes))');
        });

        it('drops the tooltip key of a custom_trigger_tooltip block', function () {
            const parsed = triggers('custom_trigger_tooltip = { tooltip = my_tooltip a = yes }');
            assert.strictEqual(conditionToString(parsed), 'and(and(a = yes))');
        });

        it('turns always into a boolean in its symbol and its quoted form', function () {
            assert.deepStrictEqual(triggers('always = yes'), folder('and', true));
            assert.deepStrictEqual(triggers('always = no'), folder('and', false));
            assert.deepStrictEqual(triggers('always = "YES"'), folder('and', true));
        });

        it('turns count_triggers into a count folder without its amount key', function () {
            const parsed = triggers('count_triggers = { amount = 2 a = yes b = yes c = yes }');
            assert.strictEqual(conditionToString(parsed), 'and(count(a = yes, b = yes, c = yes) == 2)');
        });

        it('ignores a count_triggers block without a numeric amount', function () {
            assert.deepStrictEqual(triggers('count_triggers = { a = yes }'), folder('and'));
            assert.deepStrictEqual(triggers('count_triggers = { amount = two a = yes }'), folder('and'));
        });

        it('moves into a country scope and back out again', function () {
            const stack = [countryScope];
            const parsed = extractConditionFolder(parseHoi4File('GER = { has_war = yes } a = yes').value, stack);
            assert.strictEqual(conditionToString(parsed), 'and(and([GER]has_war = yes), a = yes)');
            assert.deepStrictEqual(stack, [countryScope]);
        });

        it('names a nested scope after the scope it was entered from', function () {
            const parsed = triggers('any_owned_state = { is_coastal = yes }', { scopeName: 'GER', scopeType: 'country' });
            assert.strictEqual(conditionToString(parsed), 'and(and([GER.any_owned_state]is_coastal = yes))');
        });

        it('evaluates an if with a limit as the guarded trigger', function () {
            const text = 'if = { limit = { a = yes } b = yes }';
            assert.strictEqual(evaluate(text, ['a = yes', 'b = yes']), true);
            assert.strictEqual(evaluate(text, ['a = yes']), false);
            assert.strictEqual(evaluate(text, []), true);
            assert.strictEqual(evaluate(text, ['b = yes']), true);
        });

        it('evaluates if, else_if and else as one chain', function () {
            const text = 'if = { limit = { a = yes } b = yes else_if = { limit = { c = yes } d = yes } else = { e = yes } }';
            const cases: [string[], boolean][] = [
                [['a = yes', 'b = yes'], true],
                [['a = yes'], false],
                [['a = yes', 'd = yes', 'e = yes'], false],
                [['c = yes', 'd = yes'], true],
                [['c = yes'], false],
                [['c = yes', 'b = yes', 'e = yes'], false],
                [['e = yes'], true],
                [[], false],
                [['b = yes', 'd = yes'], false],
            ];
            for (const [trueLines, expected] of cases) {
                assert.strictEqual(evaluate(text, trueLines), expected, trueLines.join(', '));
            }
        });

        it('evaluates else_if and else written as siblings of the if the same way', function () {
            const text = 'if = { limit = { a = yes } b = yes } else_if = { limit = { c = yes } d = yes } else = { e = yes }';
            assert.strictEqual(evaluate(text, ['a = yes', 'b = yes']), true);
            assert.strictEqual(evaluate(text, ['a = yes']), false);
            assert.strictEqual(evaluate(text, ['c = yes', 'd = yes']), true);
            assert.strictEqual(evaluate(text, ['c = yes']), false);
            assert.strictEqual(evaluate(text, ['e = yes']), true);
            assert.strictEqual(evaluate(text, []), false);
        });

        it('lets an if without an else pass when no limit holds', function () {
            const text = 'if = { limit = { a = yes } b = yes else_if = { limit = { c = yes } d = yes } }';
            assert.strictEqual(evaluate(text, []), true);
            assert.strictEqual(evaluate(text, ['c = yes']), false);
        });

        it('ignores an if without a limit and an else without an if', function () {
            assert.deepStrictEqual(triggers('if = { b = yes }'), folder('and'));
            assert.deepStrictEqual(triggers('else = { b = yes } else_if = { limit = { a = yes } b = yes }'), folder('and'));
        });

        it('ignores an else_if that is not a block', function () {
            const text = 'if = { limit = { a = yes } b = yes else_if = yes }';
            assert.strictEqual(evaluate(text, ['a = yes', 'b = yes']), true);
            assert.strictEqual(evaluate(text, ['a = yes']), false);
            assert.strictEqual(evaluate(text, []), true);
        });
    });

    describe('extractConditionValue', function () {
        it('returns the simplified condition and the leaves it holds', function () {
            const value = extractConditionValue(parseHoi4File('a = yes always = yes').value, countryScope);
            assert.strictEqual(value.condition, value.exprs[0]);
            assert.deepStrictEqual(value.exprs, [a]);
        });

        it('accumulates leaves into the array it was given', function () {
            const exprs: ConditionItem[] = [];
            extractConditionValue(parseHoi4File('a = yes').value, countryScope, exprs);
            extractConditionValue(parseHoi4File('a = yes b = yes').value, countryScope, exprs);
            assert.deepStrictEqual(exprs, [a, b]);
        });

        it('joins several blocks with and', function () {
            const exprs: ConditionItem[] = [];
            const first = parseHoi4File('a = yes').value;
            const second = parseHoi4File('OR = { b = yes c = yes }').value;
            const value = extractConditionValues([first, second], countryScope, exprs);
            assert.strictEqual(conditionToString(value.condition), 'and(a = yes, or(b = yes, c = yes))');
            assert.strictEqual(value.exprs, exprs);
            assert.deepStrictEqual(exprs, [a, b, c]);
        });
    });

    describe('conditionToString', function () {
        it('formats booleans, leaves, folders and counts', function () {
            assert.strictEqual(conditionToString(true), 'true');
            assert.strictEqual(conditionToString(a), 'a = yes');
            assert.strictEqual(conditionToString(leaf('a = yes', 'GER')), '[GER]a = yes');
            assert.strictEqual(conditionToString(folder('ornot', a, folder('and', b))), 'ornot(a = yes, and(b = yes))');
            assert.strictEqual(conditionToString(count(2, a, b)), 'count(a = yes, b = yes) == 2');
        });
    });
});
