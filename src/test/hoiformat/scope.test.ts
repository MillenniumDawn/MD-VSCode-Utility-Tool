import * as assert from 'assert';
import { Node, parseHoi4File } from '../../hoiformat/hoiparser';
import { countryScope, Scope, scopeDefs, tryMoveScope } from '../../hoiformat/scope';

const ger: Scope = { scopeName: 'GER', scopeType: 'country' };
const state: Scope = { scopeName: '123', scopeType: 'state' };
const unknown: Scope = { scopeName: 'FROM', scopeType: 'unknown' };

function nodeOf(text: string): Node {
    const root = parseHoi4File(text);
    const first = (root.value as Node[])[0];
    assert.ok(first, `expected ${text} to parse to a node`);
    return first;
}

// Runs one scope move from a copy of the stack and returns what was pushed, if anything.
function move(text: string, stack: Scope[], type: 'condition' | 'effect' = 'condition'): Scope | undefined {
    const copy = [...stack];
    const moved = tryMoveScope(nodeOf(text), copy, type);
    if (!moved) {
        assert.deepStrictEqual(copy, stack, 'a refused move must leave the stack alone');
        return undefined;
    }
    assert.strictEqual(copy.length, stack.length + 1, 'a move pushes exactly one scope');
    assert.deepStrictEqual(copy.slice(0, stack.length), stack, 'a move leaves the scopes below alone');
    return copy[copy.length - 1];
}

describe('hoiformat/scope', function () {
    describe('tryMoveScope', function () {
        it('refuses a node without a name or without a block value', function () {
            const nameless = { ...nodeOf('GER = { }'), name: null };
            assert.strictEqual(tryMoveScope(nameless, [countryScope], 'condition'), false);
            assert.strictEqual(move('tag = GER', [countryScope]), undefined);
            assert.strictEqual(move('GER = yes', [countryScope]), undefined);
        });

        it('refuses a key that is neither a scope nor a scope change', function () {
            assert.strictEqual(move('has_war = { }', [countryScope]), undefined);
            assert.strictEqual(move('ger = { }', [countryScope]), undefined);
        });

        it('enters a country by its tag', function () {
            assert.deepStrictEqual(move('GER = { }', [countryScope]), ger);
            assert.deepStrictEqual(move('D01 = { }', [ger]), { scopeName: 'D01', scopeType: 'country' });
        });

        it('enters a character by its tag-prefixed id', function () {
            assert.deepStrictEqual(move('GER_angela_merkel = { }', [countryScope]), { scopeName: 'GER_angela_merkel', scopeType: 'character' });
        });

        it('enters a military industrial organization without the mio prefix', function () {
            assert.deepStrictEqual(move('mio:GER_rheinmetall = { }', [ger]), { scopeName: 'GER_rheinmetall', scopeType: 'mio' });
        });

        it('enters a state by its id', function () {
            assert.deepStrictEqual(move('64 = { }', [ger]), { scopeName: '64', scopeType: 'state' });
        });

        it('pushes the current scope again for this', function () {
            assert.deepStrictEqual(move('this = { }', [countryScope, ger]), ger);
            assert.deepStrictEqual(move('THIS = { }', [countryScope, ger]), ger);
            assert.deepStrictEqual(move('this = { }', []), countryScope);
        });

        it('pushes the bottom of the stack for root', function () {
            assert.deepStrictEqual(move('ROOT = { }', [ger, state, unknown]), ger);
            assert.deepStrictEqual(move('root = { }', []), countryScope);
        });

        it('walks back one scope per prev and stops at the bottom', function () {
            assert.deepStrictEqual(move('prev = { }', [ger, state, unknown]), state);
            assert.deepStrictEqual(move('PREV.PREV = { }', [ger, state, unknown]), ger);
            assert.deepStrictEqual(move('prev.prev.prev = { }', [ger, state, unknown]), ger);
            assert.deepStrictEqual(move('prev = { }', []), countryScope);
        });

        it('treats from inside an organization as the country it belongs to', function () {
            const mio: Scope = { scopeName: 'GER_rheinmetall', scopeType: 'mio' };
            assert.deepStrictEqual(move('FROM = { }', [ger, mio]), { scopeName: 'FROM', scopeType: 'country' });
        });

        it('leaves from unknown anywhere else, keeping its spelling', function () {
            assert.deepStrictEqual(move('FROM = { }', [ger]), { scopeName: 'FROM', scopeType: 'unknown' });
            assert.deepStrictEqual(move('from = { }', [ger]), { scopeName: 'from', scopeType: 'unknown' });
            assert.deepStrictEqual(move('FROM.FROM = { }', [ger]), { scopeName: 'FROM.FROM', scopeType: 'unknown' });
        });

        it('names a variable scope under the current scope', function () {
            assert.deepStrictEqual(move('var:my_target = { }', [ger]), { scopeName: 'GER.{var:my_target}', scopeType: 'unknown' });
            assert.deepStrictEqual(move('var:my_target = { }', [countryScope]), { scopeName: '.{var:my_target}', scopeType: 'unknown' });
        });

        // A named scope is lowercased on the way in; the event schema tests rely on that too.
        it('names an event target and a globally addressed variable on their own', function () {
            assert.deepStrictEqual(move('event_target:target = { }', [ger]), { scopeName: '{event_target:target}', scopeType: 'unknown' });
            assert.deepStrictEqual(move('global_event_target:Target = { }', [ger]), { scopeName: '{global_event_target:target}', scopeType: 'unknown' });
            assert.deepStrictEqual(move('var:USA.ally = { }', [ger]), { scopeName: '{var:usa.ally}', scopeType: 'unknown' });
            assert.deepStrictEqual(move('var:123.owner_of = { }', [ger]), { scopeName: '{var:123.owner_of}', scopeType: 'unknown' });
            assert.deepStrictEqual(move('var:global.leader = { }', [ger]), { scopeName: '{var:global.leader}', scopeType: 'unknown' });
        });

        it('keeps a variable addressed through another scope under the current one', function () {
            assert.deepStrictEqual(move('var:capital_scope.owner = { }', [ger]), { scopeName: 'GER.{var:capital_scope.owner}', scopeType: 'unknown' });
        });

        it('enters a scope that can be reached from anywhere under its own name', function () {
            assert.deepStrictEqual(move('any_country = { }', [state]), { scopeName: 'any_country', scopeType: 'country' });
            assert.deepStrictEqual(move('Any_State = { }', [ger]), { scopeName: 'any_state', scopeType: 'state' });
        });

        // Known limitation: a scope name written fully in capitals looks like a character id
        // (`TAG_name`), and a tag is recognised before the scope table is consulted.
        it('reads a scope name written in capitals as a character', function () {
            assert.deepStrictEqual(move('ANY_STATE = { }', [ger]), { scopeName: 'ANY_STATE', scopeType: 'character' });
        });

        it('enters a scope under the scope it was entered from', function () {
            assert.deepStrictEqual(move('any_owned_state = { }', [ger]), { scopeName: 'GER.any_owned_state', scopeType: 'state' });
            assert.deepStrictEqual(move('any_country_with_core = { }', [ger, state]), { scopeName: '123.any_country_with_core', scopeType: 'country' });
        });

        it('refuses a scope that cannot be entered from the current scope type', function () {
            assert.strictEqual(move('any_owned_state = { }', [state]), undefined);
            assert.strictEqual(move('any_neighbor_state = { }', [ger]), undefined);
        });

        it('allows any scope from an unknown scope', function () {
            assert.deepStrictEqual(move('any_owned_state = { }', [unknown]), { scopeName: 'FROM.any_owned_state', scopeType: 'state' });
            assert.deepStrictEqual(move('owner = { }', [unknown], 'effect'), { scopeName: 'FROM.owner', scopeType: 'country' });
        });

        it('tells condition scopes and effect scopes apart', function () {
            assert.strictEqual(move('every_country = { }', [ger], 'condition'), undefined);
            assert.deepStrictEqual(move('every_country = { }', [ger], 'effect'), { scopeName: 'every_country', scopeType: 'country' });
            assert.strictEqual(move('any_country = { }', [ger], 'effect'), undefined);
            assert.deepStrictEqual(move('overlord = { }', [ger], 'condition'), { scopeName: 'GER.overlord', scopeType: 'country' });
            assert.deepStrictEqual(move('overlord = { }', [ger], 'effect'), { scopeName: 'GER.overlord', scopeType: 'country' });
        });

        it('recognises a tag before the scope table sees the name', function () {
            // `OWN` is a valid country tag and must not fall through to a table lookup.
            assert.deepStrictEqual(move('OWN = { }', [ger]), { scopeName: 'OWN', scopeType: 'country' });
        });
    });

    describe('scopeDefs', function () {
        it('describes where a scope can be used and what it leads to', function () {
            assert.deepStrictEqual(scopeDefs['capital_scope'], { name: 'capital_scope', condition: true, effect: true, from: 'country', to: 'state' });
            assert.deepStrictEqual(scopeDefs['owner'], { name: 'owner', condition: false, effect: true, from: 'state', to: 'country' });
            assert.deepStrictEqual(scopeDefs['any_military_purchase_contract'], { name: 'any_military_purchase_contract', condition: true, effect: false, from: 'country', to: 'purchaseContract' });
            assert.strictEqual(scopeDefs['not_a_scope'], undefined);
        });
    });
});
