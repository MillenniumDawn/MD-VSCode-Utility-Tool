import * as assert from 'assert';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getEvents, ChildEvent, HOIEvent } from '../previewdef/event/schema';
import { conditionToString } from '../hoiformat/condition';

// The structures below are transcribed from Millennium Dawn's events/00_arab_spring.txt and
// events/05_united_kingdom.txt. They cover what the workflow view needs the schema to keep:
// the option's own trigger gate, the event's trigger gate, and the condition guarding each
// individual event call.

function eventsOf(input: string): HOIEvent[] {
    const parsed = getEvents(parseHoi4File(input), 'test.txt');
    return Object.values(parsed.eventItemsByNamespace).reduce<HOIEvent[]>((a, b) => a.concat(b), []);
}

function byId(events: HOIEvent[], id: string): HOIEvent {
    const found = events.find(e => e.id === id);
    assert.ok(found, `expected an event with id ${id}`);
    return found!;
}

function childrenOf(event: HOIEvent, optionName: string): ChildEvent[] {
    const option = event.options.find(o => o.name === optionName);
    assert.ok(option, `expected an option named ${optionName}`);
    return option!.childEvents;
}

describe('previewdef/event/schema option triggers', () => {
    it('keeps the option trigger instead of discarding it', () => {
        const events = eventsOf(`
            add_namespace = arab_spring
            news_event = {
                id = arab_spring.1
                title = arab_spring.1.t
                is_triggered_only = yes
                major = yes
                option = {
                    trigger = { tag = FROM }
                    name = arab_spring.1.a
                }
                option = {
                    trigger = { NOT = { tag = FROM } }
                    name = arab_spring.1.b
                }
            }
        `);

        const event = byId(events, 'arab_spring.1');
        const a = event.options.find(o => o.name === 'arab_spring.1.a');
        const b = event.options.find(o => o.name === 'arab_spring.1.b');
        assert.ok(a && b);

        assert.strictEqual(conditionToString(a!.trigger), '[{event_target}]tag = FROM');
        assert.strictEqual(conditionToString(b!.trigger), 'ornot([{event_target}]tag = FROM)');
    });

    it('reports an ungated option as unconditional', () => {
        const events = eventsOf(`
            add_namespace = arab_spring
            country_event = {
                id = arab_spring.4
                title = arab_spring.4.t
                is_triggered_only = yes
                option = { name = arab_spring.4.a }
            }
        `);

        const event = byId(events, 'arab_spring.4');
        assert.strictEqual(event.options[0]!.trigger, true);
    });
});

describe('previewdef/event/schema event triggers', () => {
    it('keeps the event-level trigger block', () => {
        const events = eventsOf(`
            add_namespace = arab_spring
            country_event = {
                id = arab_spring.0
                title = arab_spring.0.t
                is_triggered_only = yes
                trigger = {
                    is_in_array = { global.arabic_countries = THIS.id }
                    NOT = { has_country_flag = AS_arab_spring_completed }
                }
                option = { name = arab_spring.0.a }
            }
        `);

        const trigger = conditionToString(byId(events, 'arab_spring.0').trigger);
        assert.ok(trigger.startsWith('and('), `expected an and folder, got ${trigger}`);
        assert.ok(trigger.includes('is_in_array'));
        assert.ok(trigger.includes('has_country_flag = AS_arab_spring_completed'));
    });

    it('reports an event with no trigger block as unconditional', () => {
        const events = eventsOf(`
            add_namespace = arab_spring
            country_event = {
                id = arab_spring.4
                title = arab_spring.4.t
                is_triggered_only = yes
            }
        `);
        assert.strictEqual(byId(events, 'arab_spring.4').trigger, true);
    });
});

describe('previewdef/event/schema child event conditions', () => {
    it('carries the if/else_if guard down onto each call', () => {
        const events = eventsOf(`
            add_namespace = arab_spring
            country_event = {
                id = arab_spring.0
                title = arab_spring.0.t
                is_triggered_only = yes
                option = {
                    name = arab_spring.0.a
                    if = {
                        limit = { is_subject = yes }
                        OVERLORD = { country_event = { id = arab_spring.3 days = 1 } }
                    }
                    else_if = {
                        limit = { NOT = { check_variable = { influence_array^0 = 0 } } }
                        var:influence_array^0 = {
                            country_event = { id = arab_spring.3 days = 1 }
                        }
                    }
                    news_event = arab_spring.1
                }
            }
        `);

        const children = childrenOf(byId(events, 'arab_spring.0'), 'arab_spring.0.a');

        // The unconditional call stays unconditional.
        const toOne = children.filter(c => c.eventName === 'arab_spring.1');
        assert.strictEqual(toOne.length, 1);
        assert.strictEqual(toOne[0]!.condition, true);

        // Both branches of the fork survive as separate edges, each carrying its own guard.
        const toThree = children.filter(c => c.eventName === 'arab_spring.3');
        assert.strictEqual(toThree.length, 2, 'expected the if and the else_if branch to stay apart');

        // tryMoveScope lowercases a named scope, so the if branch resolves to
        // `{event_target}.overlord` and the else_if branch to `{event_target}.{var:influence_array^0}`.
        const ifBranch = toThree.find(c => c.scopeName.includes('overlord'));
        const elseBranch = toThree.find(c => c.scopeName.includes('influence_array'));
        assert.ok(ifBranch && elseBranch, toThree.map(c => c.scopeName).join(' | '));

        assert.notStrictEqual(ifBranch!.condition, true);
        assert.ok(conditionToString(ifBranch!.condition).includes('is_subject = yes'));

        assert.notStrictEqual(elseBranch!.condition, true);
        // The else_if branch is the negation of the if limit, and-folded with its own limit.
        const elseText = conditionToString(elseBranch!.condition);
        assert.ok(elseText.includes('is_subject = yes'), elseText);
        assert.ok(elseText.includes('influence_array^0 = 0'), elseText);
        assert.strictEqual(ifBranch!.days, 1);
        assert.strictEqual(elseBranch!.days, 1);
    });

    it('keeps two differently guarded calls to the same event under the same scope apart', () => {
        const events = eventsOf(`
            add_namespace = test
            country_event = {
                id = test.1
                title = test.1.t
                is_triggered_only = yes
                option = {
                    name = test.1.a
                    if = {
                        limit = { has_country_flag = alpha }
                        country_event = { id = test.2 days = 1 }
                    }
                    if = {
                        limit = { has_country_flag = beta }
                        country_event = { id = test.2 days = 1 }
                    }
                }
            }
        `);

        const children = childrenOf(byId(events, 'test.1'), 'test.1.a').filter(c => c.eventName === 'test.2');
        assert.strictEqual(children.length, 2, 'the uniqBy key must include the condition');
        const texts = children.map(c => conditionToString(c.condition)).sort();
        assert.ok(texts[0]!.includes('alpha'), texts.join(' | '));
        assert.ok(texts[1]!.includes('beta'), texts.join(' | '));
    });

    it('still collapses a genuinely duplicated call', () => {
        const events = eventsOf(`
            add_namespace = test
            country_event = {
                id = test.1
                title = test.1.t
                is_triggered_only = yes
                option = {
                    name = test.1.a
                    country_event = { id = test.2 days = 1 }
                    country_event = { id = test.2 days = 1 }
                }
            }
        `);

        const children = childrenOf(byId(events, 'test.1'), 'test.1.a').filter(c => c.eventName === 'test.2');
        assert.strictEqual(children.length, 1);
    });

    it('carries the guard onto a call fired from immediate', () => {
        const events = eventsOf(`
            add_namespace = ENG_inner_circle_charles
            country_event = {
                id = ENG_inner_circle_charles.01
                title = ENG_inner_circle_charles.01.t
                hidden = yes
                is_triggered_only = yes
                immediate = {
                    if = {
                        limit = { NOT = { has_completed_focus = ENG_harmony_doctrine } }
                        country_event = { id = ENG_inner_circle_charles.02 days = 30 }
                    }
                }
            }
        `);

        const event = byId(events, 'ENG_inner_circle_charles.01');
        assert.strictEqual(event.hidden, true);
        const children = event.immediate.childEvents;
        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0]!.eventName, 'ENG_inner_circle_charles.02');
        assert.strictEqual(children[0]!.days, 30);
        assert.ok(conditionToString(children[0]!.condition).includes('ENG_harmony_doctrine'));
    });

    it('records the branch weight for a call inside random_list', () => {
        const events = eventsOf(`
            add_namespace = test
            country_event = {
                id = test.1
                title = test.1.t
                is_triggered_only = yes
                option = {
                    name = test.1.a
                    random_list = {
                        70 = { country_event = { id = test.2 } }
                        30 = { country_event = { id = test.3 } }
                    }
                }
            }
        `);

        const children = childrenOf(byId(events, 'test.1'), 'test.1.a');
        const two = children.find(c => c.eventName === 'test.2');
        const three = children.find(c => c.eventName === 'test.3');
        assert.ok(two && three);
        assert.strictEqual(two!.possibility, 70);
        assert.strictEqual(three!.possibility, 30);
    });

    it('keeps the guard on a call inside a random_list nested in an if', () => {
        const events = eventsOf(`
            add_namespace = test
            country_event = {
                id = test.1
                title = test.1.t
                is_triggered_only = yes
                option = {
                    name = test.1.a
                    if = {
                        limit = { is_subject = yes }
                        random_list = {
                            70 = { country_event = { id = test.2 } }
                            30 = { country_event = { id = test.3 } }
                        }
                    }
                }
            }
        `);

        const children = childrenOf(byId(events, 'test.1'), 'test.1.a');
        assert.strictEqual(children.length, 2);
        for (const child of children) {
            const condition = conditionToString(child.condition);
            assert.ok(
                condition.includes('is_subject = yes'),
                `${child.eventName} lost its guard: ${condition}`,
            );
            // The guard is stated once; the enclosing `if` is not folded onto itself.
            assert.strictEqual(condition.split('is_subject = yes').length - 1, 1, condition);
        }
    });

    it('keeps two calls to the same event apart when only the delay differs', () => {
        const events = eventsOf(`
            add_namespace = test
            country_event = {
                id = test.1
                title = test.1.t
                is_triggered_only = yes
                option = {
                    name = test.1.a
                    country_event = { id = test.2 days = 1 }
                    country_event = { id = test.2 days = 30 }
                }
            }
        `);

        const children = childrenOf(byId(events, 'test.1'), 'test.1.a');
        assert.deepStrictEqual(children.map(c => c.days).sort((a, b) => a - b), [1, 30]);
    });
});

describe('previewdef/event/schema condition expressions', () => {
    it('collects the condition leaves reached across the file', () => {
        const parsed = getEvents(parseHoi4File(`
            add_namespace = test
            country_event = {
                id = test.1
                title = test.1.t
                is_triggered_only = yes
                trigger = { has_country_flag = gate }
                option = {
                    name = test.1.a
                    trigger = { tag = FROM }
                    if = {
                        limit = { is_subject = yes }
                        country_event = { id = test.2 }
                    }
                }
            }
        `), 'test.txt');

        const contents = parsed.conditionExprs.map(e => e.nodeContent);
        assert.ok(contents.some(c => c.includes('has_country_flag = gate')), contents.join(' | '));
        assert.ok(contents.some(c => c.includes('tag = FROM')), contents.join(' | '));
        assert.ok(contents.some(c => c.includes('is_subject = yes')), contents.join(' | '));
        // Deduplicated by scope + content.
        assert.strictEqual(new Set(contents.map((c, i) => parsed.conditionExprs[i]!.scopeName + '@' + c)).size, contents.length);
    });
});
