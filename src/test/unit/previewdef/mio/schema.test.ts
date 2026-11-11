import * as assert from 'assert';
import { applyCondition } from '../../../../hoiformat/condition';
import { parseHoi4File } from '../../../../hoiformat/hoiparser';
import { getMiosFromFile, Mio, MioTrait } from '../../../../previewdef/mio/schema';

describe('previewdef/mio/schema tree_header_text', () => {
    it('parses multiple tree_header_text blocks into textHeaders', () => {
        const input = `
            test_org = {
                name = test_org
                tree_header_text = {
                    text = test_org_first_header
                    x = 2
                }
                tree_header_text = {
                    text = test_org_second_header
                    x = 6
                }
                trait = {
                    token = test_org_trait
                    position = { x = 2 y = 0 }
                }
            }
        `;
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.strictEqual(mios.length, 1);
        assert.deepStrictEqual(mios[0].textHeaders, [
            { text: 'test_org_first_header', x: 2 },
            { text: 'test_org_second_header', x: 6 },
        ]);
    });

    it('yields an empty textHeaders array when the field is absent', () => {
        const input = `
            test_org = {
                name = test_org
                trait = {
                    token = test_org_trait
                    position = { x = 0 y = 0 }
                }
            }
        `;
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.strictEqual(mios.length, 1);
        assert.deepStrictEqual(mios[0].textHeaders, []);
    });

    it('defaults a missing x to 0 and skips a header with no text', () => {
        const input = `
            test_org = {
                name = test_org
                tree_header_text = {
                    text = test_org_header_no_x
                }
                tree_header_text = {
                    x = 4
                }
            }
        `;
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.deepStrictEqual(mios[0].textHeaders, [
            { text: 'test_org_header_no_x', x: 0 },
        ]);
    });
});

describe('previewdef/mio/schema trait tokens', () => {
    // A token is whatever the file wrote. One named after a prototype slot has to be a trait
    // like any other, and overriding it must not reach past the map to Object itself.
    it('keeps a trait whose token is a prototype slot name', () => {
        const input = `
            test_org = {
                name = test_org
                trait = {
                    token = __proto__
                    position = { x = 1 y = 0 }
                }
                trait = {
                    token = constructor
                    position = { x = 2 y = 0 }
                }
                override_trait = {
                    token = constructor
                    position = { x = 3 y = 0 }
                }
            }
        `;
        const before = Object.getOwnPropertyNames(Object);
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.deepStrictEqual(Object.keys(mios[0].traits).sort(), ['__proto__', 'constructor']);
        assert.strictEqual(mios[0].traits['__proto__'].x, 1);
        assert.strictEqual(mios[0].traits['constructor'].x, 3);
        assert.deepStrictEqual(Object.getOwnPropertyNames(Object), before);
    });
});

describe('previewdef/mio/schema prerequisites', () => {
    const cases: Array<{ form: string; trait: string; expect: Partial<MioTrait> }> = [
        {
            form: 'no prerequisite',
            trait: '',
            expect: { anyParent: [], allParents: [], parent: undefined, exclusive: [] },
        },
        {
            form: 'any_parent',
            trait: 'any_parent = { a b }',
            expect: { anyParent: ['a', 'b'], allParents: [], parent: undefined },
        },
        {
            form: 'all_parents',
            trait: 'all_parents = { a b }',
            expect: { anyParent: [], allParents: ['a', 'b'], parent: undefined },
        },
        {
            form: 'parent without num_parents_needed',
            trait: 'parent = { traits = { a b } }',
            expect: { parent: { traits: ['a', 'b'], numNeeded: 1 } },
        },
        {
            form: 'parent with num_parents_needed',
            trait: 'parent = { traits = { a b } num_parents_needed = 2 }',
            expect: { parent: { traits: ['a', 'b'], numNeeded: 2 } },
        },
        {
            form: 'parent with an empty trait list',
            trait: 'parent = { traits = { } num_parents_needed = 2 }',
            expect: { parent: undefined },
        },
        {
            form: 'mutually_exclusive',
            trait: 'mutually_exclusive = { b }',
            expect: { exclusive: ['b'] },
        },
    ];

    for (const { form, trait, expect } of cases) {
        it(`reads the ${form} form`, () => {
            const input = `
                test_org = {
                    trait = { token = a position = { x = 0 y = 0 } }
                    trait = { token = b position = { x = 1 y = 0 } }
                    trait = { token = c position = { x = 0 y = 1 } ${trait} }
                }
            `;
            const traits = getMiosFromFile(parseHoi4File(input), [], 'test.txt')[0].traits;
            for (const key of Object.keys(expect) as Array<keyof MioTrait>) {
                assert.deepStrictEqual(traits['c'][key], expect[key], `${form}: ${key}`);
            }
        });
    }
});

describe('previewdef/mio/schema include', () => {
    const base = `
        base_org = {
            trait = {
                token = root
                position = { x = 0 y = 0 }
            }
            trait = {
                token = kept
                name = kept_name
                position = { x = 0 y = 1 }
                any_parent = { root }
                mutually_exclusive = { removed }
            }
            trait = {
                token = removed
                position = { x = 1 y = 1 }
            }
        }
    `;

    function load(rest: string): Record<string, Mio> {
        const mios = getMiosFromFile(parseHoi4File(base + rest), [], 'test.txt');
        return Object.fromEntries(mios.map(mio => [mio.id, mio]));
    }

    it('adds, overrides and hides traits on top of the included MIO', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                add_trait = {
                    token = added
                    position = { x = 2 y = 0 }
                }
                override_trait = {
                    token = kept
                    name = new_name
                    all_parents = { added }
                }
                remove_trait = { removed }
            }
        `)['derived_org'];

        assert.deepStrictEqual(Object.keys(derived.traits).sort(), ['added', 'kept', 'removed', 'root']);
        const kept = derived.traits['kept'];
        assert.strictEqual(kept.name, 'new_name');
        assert.deepStrictEqual(kept.allParents, ['added'], 'a non-empty list replaces the old one');
        assert.deepStrictEqual(kept.anyParent, ['root'], 'an absent list keeps the old one');
        assert.deepStrictEqual(kept.exclusive, ['removed']);
        assert.strictEqual(kept.sourceMioId, 'derived_org');
        // remove_trait hides a trait rather than deleting it, so what points at it still resolves.
        assert.strictEqual(derived.traits['removed'].hasVisible, true);
        assert.strictEqual(derived.traits['removed'].visible, false);
        assert.deepStrictEqual(derived.warnings, []);
    });

    it('leaves the included MIO untouched by an override_trait', () => {
        const baseMio = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = kept
                    name = new_name
                    position = { x = 5 y = 5 }
                    any_parent = { removed }
                }
            }
        `)['base_org'];

        const kept = baseMio.traits['kept'];
        assert.strictEqual(kept.name, 'kept_name');
        assert.strictEqual(kept.x, 0);
        assert.deepStrictEqual(kept.anyParent, ['root']);
        assert.strictEqual(kept.sourceMioId, 'base_org');
    });

    it('resolves an include from another file through the dependent MIOs', () => {
        const dependent = getMiosFromFile(parseHoi4File(base), [], 'base.txt');
        const mios = getMiosFromFile(parseHoi4File(`
            derived_org = {
                include = base_org
                remove_trait = { removed }
            }
        `), dependent, 'derived.txt');

        assert.strictEqual(mios.length, 1);
        assert.deepStrictEqual(Object.keys(mios[0].traits).sort(), ['kept', 'removed', 'root']);
        assert.strictEqual(mios[0].traits['removed'].visible, false);
        assert.notStrictEqual(dependent[0].traits['removed'].visible, false);
    });

    it('warns about trait next to include, and add_trait without include', () => {
        const mios = load(`
            derived_org = {
                include = base_org
                trait = { token = plain position = { x = 3 y = 0 } }
            }
            loose_org = {
                add_trait = { token = loose position = { x = 0 y = 0 } }
            }
        `);

        const derived = mios['derived_org'].warnings;
        const loose = mios['loose_org'].warnings;
        assert.ok(derived.some(w => w.text.includes('should use add_trait')), JSON.stringify(derived));
        assert.ok(loose.some(w => w.text.includes('should use trait instead')), JSON.stringify(loose));
    });

    it('warns about a duplicate trait id and an override of an unknown trait', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                add_trait = { token = kept position = { x = 3 y = 0 } }
                override_trait = { token = nowhere name = x }
            }
        `)['derived_org'].warnings;

        assert.ok(derived.some(w => w.text.includes('more than one trait with ID kept')), JSON.stringify(derived));
        assert.ok(derived.some(w => w.text.includes("doesn't exist: nowhere")), JSON.stringify(derived));
    });
});

describe('previewdef/mio/schema delete_included_values', () => {
    const base = `
        base_org = {
            trait = {
                token = root
                position = { x = 1 y = 0 }
            }
            trait = {
                token = anchored
                name = anchored_name
                icon = GFX_anchored
                position = { x = 2 y = 1 }
                relative_position_id = root
                equipment_bonus = { equipment = { infantry_equipment = 2 } }
                production_bonus = { industrial_complex = 1 }
                organization_modifier = { org_gain = 5 }
                all_parents = { root }
                parent = { traits = { root } num_parents_needed = 1 }
            }
        }
    `;

    function load(rest: string): Record<string, Mio> {
        const mios = getMiosFromFile(parseHoi4File(base + rest), [], 'test.txt');
        return Object.fromEntries(mios.map(mio => [mio.id, mio]));
    }

    it('resets each deleted field to its fresh-trait default and keeps the rest', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    delete_included_values = { relative_position_id all_parents parent name position }
                }
            }
        `)['derived_org'];
        const anchored = derived.traits['anchored'];
        assert.strictEqual(anchored.relativePositionId, undefined);
        assert.deepStrictEqual(anchored.allParents, []);
        assert.strictEqual(anchored.parent, undefined);
        assert.strictEqual(anchored.name, '');
        assert.deepStrictEqual([anchored.x, anchored.y], [0, 0]);
        assert.strictEqual(anchored.icon, 'GFX_anchored', 'a field not listed keeps the inherited value');
    });

    it('clears visibility, links and presentation without changing the included trait', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base_org = { trait = {
                token = example
                icon = GFX_example
                any_parent = { a }
                mutually_exclusive = { b }
                visible = { always = no }
                special_trait_background = yes
            } }
            derived_org = {
                include = base_org
                override_trait = {
                    token = example
                    delete_included_values = { icon any_parent mutually_exclusive visible special_trait_background unused }
                }
            }
        `), [], 'test.txt');
        const baseTrait = mios.find(mio => mio.id === 'base_org')!.traits['example'];
        const trait = mios.find(mio => mio.id === 'derived_org')!.traits['example'];
        assert.strictEqual(trait.icon, undefined);
        assert.deepStrictEqual(trait.anyParent, []);
        assert.deepStrictEqual(trait.exclusive, []);
        assert.strictEqual(trait.visible, true);
        assert.strictEqual(trait.hasVisible, false);
        assert.strictEqual(trait.specialTraitBackground, false);
        assert.strictEqual(baseTrait.icon, 'GFX_example');
        assert.deepStrictEqual(baseTrait.anyParent, ['a']);
        assert.deepStrictEqual(baseTrait.exclusive, ['b']);
        assert.strictEqual(baseTrait.hasVisible, true);
        assert.strictEqual(baseTrait.specialTraitBackground, true);
    });

    it('keeps explicit bonuses that replace deleted inherited bonuses', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    delete_included_values = { equipment_bonus production_bonus organization_modifier }
                    equipment_bonus = { soft_attack = 0.1 }
                    production_bonus = { production_cost_factor = -0.1 }
                    organization_modifier = { org_gain = 1 }
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['anchored'].effects, ['equiment', 'production', 'organization']);
    });

    it('clears a deleted bonus category only', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    delete_included_values = { equipment_bonus }
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['anchored'].effects, ['production', 'organization']);
    });

    it('clears every deleted bonus category', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    delete_included_values = { equipment_bonus production_bonus organization_modifier }
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['anchored'].effects, []);
    });

    it('keeps an explicitly overridden value after deleting the same field', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    relative_position_id = root
                    delete_included_values = { relative_position_id }
                }
            }
        `)['derived_org'];
        assert.strictEqual(derived.traits['anchored'].relativePositionId, 'root');
    });

    it('applies ordinary overrides beside a deletion', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    name = renamed
                    delete_included_values = { relative_position_id }
                }
            }
        `)['derived_org'];
        const anchored = derived.traits['anchored'];
        assert.strictEqual(anchored.name, 'renamed');
        assert.strictEqual(anchored.relativePositionId, undefined);
    });

    it('leaves the included MIO untouched by a deletion', () => {
        const baseMio = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = anchored
                    delete_included_values = { relative_position_id equipment_bonus all_parents position }
                }
            }
        `)['base_org'];
        const anchored = baseMio.traits['anchored'];
        assert.strictEqual(anchored.relativePositionId, 'root');
        assert.deepStrictEqual(anchored.effects, ['equiment', 'production', 'organization']);
        assert.deepStrictEqual(anchored.allParents, ['root']);
        assert.deepStrictEqual([anchored.x, anchored.y], [2, 1]);
        assert.strictEqual(anchored.sourceMioId, 'base_org');
    });
});

describe('previewdef/mio/schema bonus overrides', () => {
    const base = `
        base_org = {
            trait = {
                token = armed
                icon = GFX_armed
                position = { x = 0 y = 0 }
                equipment_bonus = { soft_attack = 0.1 }
            }
            trait = {
                token = full
                position = { x = 1 y = 0 }
                equipment_bonus = { soft_attack = 0.1 }
                production_bonus = { production_speed_buildings_factor = 0.1 }
                organization_modifier = { org_gain = 1 }
            }
        }
    `;

    function load(rest: string): Record<string, Mio> {
        const mios = getMiosFromFile(parseHoi4File(base + rest), [], 'test.txt');
        return Object.fromEntries(mios.map(mio => [mio.id, mio]));
    }

    it('adds the icons of bonus categories an override names that the included trait lacked', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = armed
                    production_bonus = { production_speed_industry_factor = 0.1 }
                    organization_modifier = { org_gain = 2 }
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['armed'].effects, ['equiment', 'production', 'organization']);
    });

    it('shows each named category once, whether or not the included trait had it', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = full
                    production_bonus = { production_speed_buildings_factor = 0.2 }
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['full'].effects, ['equiment', 'production', 'organization']);
    });

    it('keeps the inherited bonuses an override does not name', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = full
                    name = renamed
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['full'].effects, ['equiment', 'production', 'organization']);
    });

    it('applies repeated overrides to the same trait without duplicating icons', () => {
        const derived = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = armed
                    production_bonus = { production_speed_industry_factor = 0.1 }
                }
                override_trait = {
                    token = armed
                    organization_modifier = { org_gain = 2 }
                }
            }
        `)['derived_org'];
        assert.deepStrictEqual(derived.traits['armed'].effects, ['equiment', 'production', 'organization']);
    });

    it('leaves the inherited effects array untouched by the overrides', () => {
        const mios = load(`
            derived_org = {
                include = base_org
                override_trait = {
                    token = armed
                    production_bonus = { production_speed_industry_factor = 0.1 }
                    organization_modifier = { org_gain = 2 }
                }
            }
            second_org = {
                include = base_org
                override_trait = {
                    token = armed
                    production_bonus = { production_speed_buildings_factor = 0.1 }
                }
            }
        `);
        assert.deepStrictEqual(mios.base_org.traits['armed'].effects, ['equiment']);
        assert.deepStrictEqual(mios.derived_org.traits['armed'].effects, ['equiment', 'production', 'organization']);
        assert.deepStrictEqual(mios.second_org.traits['armed'].effects, ['equiment', 'production']);
    });
});

describe('previewdef/mio/schema link warnings', () => {
    function warningsOf(traits: string, extra = ''): { text: string, source: string, relatedSources?: string[] }[] {
        const mios = getMiosFromFile(parseHoi4File(`test_org = { ${traits} } ${extra}`), [], 'test.txt');
        return mios.find(m => m.id === 'test_org')!.warnings;
    }

    function texts(traits: string): string[] {
        return warningsOf(traits).map(w => w.text);
    }

    it('accepts parents that sit above the trait they unlock', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 0 } }
            trait = { token = b position = { x = 1 y = 0 } }
            trait = { token = c position = { x = 0 y = 1 } all_parents = { a } any_parent = { a b } parent = { traits = { a b } num_parents_needed = 2 } }
        `), []);
    });

    it('warns about an all_parents parent on the same row or below', () => {
        const warnings = warningsOf(`
            trait = { token = a position = { x = 0 y = 1 } }
            trait = { token = b position = { x = 1 y = 2 } }
            trait = { token = c position = { x = 0 y = 1 } all_parents = { a b } }
        `);
        assert.deepStrictEqual(warnings, [
            { text: 'Parent a of trait c is not positioned above it.', source: 'c', relatedSources: ['a'] },
            { text: 'Parent b of trait c is not positioned above it.', source: 'c', relatedSources: ['b'] },
        ]);
    });

    it('accepts any_parent when one option is above, and warns when none is', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 0 } }
            trait = { token = b position = { x = 1 y = 3 } }
            trait = { token = c position = { x = 0 y = 1 } any_parent = { a b } }
        `), []);
        assert.deepStrictEqual(warningsOf(`
            trait = { token = a position = { x = 0 y = 2 } }
            trait = { token = b position = { x = 1 y = 3 } }
            trait = { token = c position = { x = 0 y = 1 } any_parent = { a b } }
        `), [{ text: 'Parent a, b of trait c is not positioned above it.', source: 'c', relatedSources: ['a', 'b'] }]);
    });

    it('warns about a parent block with fewer parents above than it needs', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 0 } }
            trait = { token = b position = { x = 1 y = 0 } }
            trait = { token = d position = { x = 2 y = 4 } }
            trait = { token = c position = { x = 0 y = 1 } parent = { traits = { a b d } num_parents_needed = 2 } }
        `), []);
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 0 } }
            trait = { token = b position = { x = 1 y = 4 } }
            trait = { token = c position = { x = 0 y = 1 } parent = { traits = { a b } num_parents_needed = 2 } }
        `), ['Parent b of trait c is not positioned above it.']);
    });

    it('warns about a parent block that needs more parents than it lists', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 0 } }
            trait = { token = c position = { x = 0 y = 1 } parent = { traits = { a } num_parents_needed = 2 } }
        `), ['Trait c needs 2 parents but lists only 1, so it can never be unlocked.']);
    });

    it('warns about a parent or exclusive trait that does not exist', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = c position = { x = 0 y = 1 } all_parents = { nowhere } mutually_exclusive = { ghost } }
        `), [
            'Parent nowhere of trait c does not exist.',
            'Mutually exclusive trait ghost of trait c does not exist.',
        ]);
    });

    it('warns once about mutually exclusive traits on different rows', () => {
        const warnings = warningsOf(`
            trait = { token = a position = { x = 0 y = 0 } mutually_exclusive = { b } }
            trait = { token = b position = { x = 2 y = 1 } mutually_exclusive = { a } }
            trait = { token = c position = { x = 4 y = 0 } mutually_exclusive = { a } }
        `);
        assert.deepStrictEqual(warnings, [
            { text: 'Mutually exclusive traits a and b are not on the same row.', source: 'a', relatedSources: ['b'] },
        ]);
    });

    it('resolves positions through relative_position_id', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 2 } }
            trait = { token = b position = { x = 0 y = 1 } relative_position_id = a all_parents = { a } }
        `), []);
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 2 } }
            trait = { token = b position = { x = 0 y = -1 } relative_position_id = a all_parents = { a } }
        `), ['Parent a of trait b is not positioned above it.']);
    });

    it('skips a removed trait', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base_org = {
                trait = { token = a position = { x = 0 y = 0 } }
                trait = { token = b position = { x = 0 y = 1 } all_parents = { a } mutually_exclusive = { c } }
                trait = { token = c position = { x = 1 y = 1 } mutually_exclusive = { b } }
            }
            derived_org = {
                include = base_org
                override_trait = { token = a position = { x = 0 y = 3 } }
                remove_trait = { b }
                add_trait = { token = d position = { x = 3 y = 0 } mutually_exclusive = { c } }
            }
        `), [], 'test.txt');
        const derived = mios.find(m => m.id === 'derived_org')!;
        // b is below the moved a, but it is removed; d and c are on different rows.
        assert.deepStrictEqual(derived.warnings.map(w => w.text), [
            'Mutually exclusive traits d and c are not on the same row.',
        ]);
    });

    // The cycle is warned about already; the trait it started from is drawn at its own offset, as
    // the preview draws it, not pushed down by counting its own y twice.
    it('cuts a circular relative_position_id chain where the preview does', () => {
        assert.deepStrictEqual(texts(`
            trait = { token = a position = { x = 0 y = 2 } relative_position_id = b }
            trait = { token = b position = { x = 1 y = 0 } relative_position_id = a }
            trait = { token = c position = { x = 0 y = 3 } all_parents = { a } }
        `).filter(t => !t.includes('circular')), []);
    });

    // Neither end of either link is the derived organization's, but the anchor they hang from is,
    // and moving it moves them.
    it('checks the inherited links a derived organization moves by overriding their anchor', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base_org = {
                trait = { token = anchor position = { x = 0 y = 1 } }
                trait = { token = top position = { x = 1 y = 1 } }
                trait = { token = child position = { x = 0 y = 1 } relative_position_id = anchor all_parents = { top } }
                trait = { token = left position = { x = 2 y = 0 } relative_position_id = anchor mutually_exclusive = { right } }
                trait = { token = right position = { x = 3 y = 1 } mutually_exclusive = { left } }
            }
            derived_org = {
                include = base_org
                override_trait = { token = anchor position = { x = 0 y = 0 } }
            }
        `), [], 'test.txt');
        const byId = Object.fromEntries(mios.map(m => [m.id, m.warnings.map(w => w.text)]));
        assert.deepStrictEqual(byId['base_org'], []);
        assert.deepStrictEqual(byId['derived_org'], [
            'Parent top of trait child is not positioned above it.',
            'Mutually exclusive traits left and right are not on the same row.',
        ]);
    });

    it('does not repeat in a derived organization what its included one reports', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base_org = {
                trait = { token = a position = { x = 0 y = 1 } }
                trait = { token = b position = { x = 0 y = 0 } all_parents = { a } }
            }
            derived_org = {
                include = base_org
                add_trait = { token = c position = { x = 1 y = 0 } all_parents = { a } }
            }
        `), [], 'test.txt');
        const byId = Object.fromEntries(mios.map(m => [m.id, m.warnings.map(w => w.text)]));
        assert.deepStrictEqual(byId['base_org'], ['Parent a of trait b is not positioned above it.']);
        assert.deepStrictEqual(byId['derived_org'], ['Parent a of trait c is not positioned above it.']);
    });
});

describe('previewdef/mio/schema include chains', () => {
    // The organization an include names is resolved wherever the file puts it. A chain written
    // head first must carry every trait in it, the same as the reversed order.
    it('resolves a forward include chain of depth three', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            a_org = { include = b_org add_trait = { token = a_trait position = { x = 0 y = 0 } } }
            b_org = { include = c_org add_trait = { token = b_trait position = { x = 1 y = 0 } } }
            c_org = { trait = { token = c_trait position = { x = 2 y = 0 } } }
        `), [], 'test.txt');
        const byId = Object.fromEntries(mios.map(m => [m.id, m]));
        assert.deepStrictEqual(Object.keys(byId['a_org'].traits).sort(), ['a_trait', 'b_trait', 'c_trait']);
        assert.deepStrictEqual(Object.keys(byId['b_org'].traits).sort(), ['b_trait', 'c_trait']);
        for (const mio of mios) {
            assert.deepStrictEqual(mio.warnings, []);
        }
    });

    it('resolves a forward include chain of depth four', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            w_org = { include = x_org add_trait = { token = w_trait position = { x = 0 y = 0 } } }
            x_org = { include = y_org add_trait = { token = x_trait position = { x = 1 y = 0 } } }
            y_org = { include = z_org add_trait = { token = y_trait position = { x = 2 y = 0 } } }
            z_org = { trait = { token = z_trait position = { x = 3 y = 0 } } }
        `), [], 'test.txt');
        const w = mios.find(m => m.id === 'w_org')!;
        assert.deepStrictEqual(Object.keys(w.traits).sort(), ['w_trait', 'x_trait', 'y_trait', 'z_trait']);
    });

    it('resolves the same chain written tail first', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            c_org = { trait = { token = c_trait position = { x = 2 y = 0 } } }
            b_org = { include = c_org add_trait = { token = b_trait position = { x = 1 y = 0 } } }
            a_org = { include = b_org add_trait = { token = a_trait position = { x = 0 y = 0 } } }
        `), [], 'test.txt');
        const a = mios.find(m => m.id === 'a_org')!;
        assert.deepStrictEqual(Object.keys(a.traits).sort(), ['a_trait', 'b_trait', 'c_trait']);
    });

    it('keeps the defining organization and overrides of traits a chain passes on', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            a_org = {
                include = b_org
                add_trait = { token = a_trait position = { x = 0 y = 0 } }
                override_trait = { token = c_trait name = a_name }
            }
            b_org = {
                include = c_org
                add_trait = { token = b_trait position = { x = 1 y = 0 } }
                override_trait = { token = c_trait name = b_name }
            }
            c_org = { trait = { token = c_trait name = c_name position = { x = 2 y = 0 } } }
        `), [], 'test.txt');
        const byId = Object.fromEntries(mios.map(m => [m.id, m]));
        const seenFromA = byId['a_org'].traits['c_trait'];
        assert.strictEqual(seenFromA.name, 'a_name');
        assert.strictEqual(seenFromA.sourceMioId, 'a_org');
        assert.strictEqual(seenFromA.file, 'test.txt');
        assert.ok(seenFromA.token, 'the overriding definition is what the preview navigates to');
        assert.strictEqual(byId['a_org'].traits['a_trait'].sourceMioId, 'a_org');
        assert.strictEqual(byId['a_org'].traits['b_trait'].sourceMioId, 'b_org');
        // The organizations above stay as each of them wrote it: overriding on the way out is a
        // copy, not a write into the included ones.
        assert.strictEqual(byId['b_org'].traits['c_trait'].name, 'b_name');
        assert.strictEqual(byId['b_org'].traits['c_trait'].sourceMioId, 'b_org');
        assert.strictEqual(byId['c_org'].traits['c_trait'].name, 'c_name');
        assert.strictEqual(byId['c_org'].traits['c_trait'].sourceMioId, 'c_org');
    });
});

describe('previewdef/mio/schema include cycles', () => {
    const cycleWarning = 'Circular includes between military industrial organizations: ';

    it('terminates a two-organization include cycle and warns both organizations', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            a_org = { include = b_org add_trait = { token = a_trait position = { x = 0 y = 0 } } }
            b_org = { include = a_org add_trait = { token = b_trait position = { x = 1 y = 0 } } }
        `), [], 'test.txt');
        assert.strictEqual(mios.length, 2);
        const byId = Object.fromEntries(mios.map(m => [m.id, m]));
        for (const mio of mios) {
            assert.deepStrictEqual(mio.warnings.map(w => w.text), [`${cycleWarning}a_org -> b_org -> a_org.`]);
            assert.strictEqual(mio.warnings[0].source, mio.id);
        }
        // The cycle has no complete tree to close on, but what each organization wrote is kept.
        assert.ok(byId['a_org'].traits['a_trait']);
        assert.ok(byId['b_org'].traits['b_trait']);
    });

    it('warns an organization that includes itself', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            a_org = { include = a_org add_trait = { token = a_trait position = { x = 0 y = 0 } } }
        `), [], 'test.txt');
        assert.strictEqual(mios.length, 1);
        assert.deepStrictEqual(mios[0].warnings.map(w => w.text), [`${cycleWarning}a_org -> a_org.`]);
        assert.ok(mios[0].traits['a_trait']);
    });

    it('warns an organization that includes into the cycle from outside', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            a_org = { include = b_org add_trait = { token = a_trait position = { x = 0 y = 0 } } }
            b_org = { include = a_org add_trait = { token = b_trait position = { x = 1 y = 0 } } }
            w_org = { include = a_org add_trait = { token = w_trait position = { x = 2 y = 0 } } }
        `), [], 'test.txt');
        assert.strictEqual(mios.length, 3);
        const byId = Object.fromEntries(mios.map(m => [m.id, m]));
        for (const mio of mios) {
            assert.deepStrictEqual(mio.warnings.map(w => w.text), [`${cycleWarning}a_org -> b_org -> a_org.`]);
        }
        assert.ok(byId['w_org'].traits['w_trait']);
    });
});


describe('previewdef/mio/schema availability', () => {
    it('preserves direct, added, inherited and overridden requirements independently of visibility', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base = {
                trait = { token = inherited available = { GER = { has_tech = stealth_corvette_hull_1 } } }
                trait = { token = overridden available = { GER = { owns_state = 155 } } }
                trait = { token = plain }
                trait = { token = locked visible = { always = yes } available = { always = no } }
            }
            derived = {
                include = base
                override_trait = { token = overridden available = { TUR = { has_tech = stealth_corvette_hull_1 } } }
                add_trait = { token = added available = { TUR = { owns_state = 155 } } }
            }
        `), [], 'availability.txt');
        const base = mios.find(m => m.id === 'base')!;
        const derived = mios.find(m => m.id === 'derived')!;
        assert.deepStrictEqual(derived.traits.inherited.available, base.traits.inherited.available);
        assert.notDeepStrictEqual(derived.traits.overridden.available, base.traits.overridden.available);
        assert.strictEqual(derived.traits.plain.available, true);
        assert.strictEqual(derived.traits.plain.hasAvailable, false);
        assert.strictEqual(base.traits.locked.visible, true);
        assert.strictEqual(base.traits.locked.available, false);
        for (const id of ['inherited', 'overridden', 'added']) {
            const trait = derived.traits[id];
            assert.strictEqual(trait.hasAvailable, true);
            assert.strictEqual(applyCondition(trait.available, []), false);
            assert.strictEqual(applyCondition(trait.available, derived.conditionExprs), true);
        }
        assert.ok(derived.conditionExprs.some(c => c.scopeName === 'TUR' && c.nodeContent.includes('owns_state')));
        assert.ok(base.conditionExprs.every(c => c.scopeName !== 'TUR'));
    });

    it('clears inherited availability before applying explicit replacement values', () => {
        const mios = getMiosFromFile(parseHoi4File(`
            base = { trait = { token = t available = { always = no } } }
            cleared = { include = base override_trait = { token = t delete_included_values = { available } } }
            replaced = { include = base override_trait = { token = t delete_included_values = { available } available = { TUR = { owns_state = 155 } } } }
        `), [], 'availability.txt');
        const cleared = mios.find(m => m.id === 'cleared')!.traits.t;
        assert.strictEqual(cleared.available, true);
        assert.strictEqual(cleared.hasAvailable, false);
        assert.strictEqual(mios.find(m => m.id === 'base')!.traits.t.available, false);
        const replaced = mios.find(m => m.id === 'replaced')!;
        assert.strictEqual(replaced.traits.t.hasAvailable, true);
        assert.strictEqual(applyCondition(replaced.traits.t.available, []), false);
        assert.strictEqual(applyCondition(replaced.traits.t.available, replaced.conditionExprs), true);
    });
});
