import * as assert from 'assert';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getMiosFromFile, Mio, MioTrait } from '../previewdef/mio/schema';

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
