import * as assert from 'assert';
import {
    FocusTreeStructureInput,
    FocusTreeObjectStructureInput,
    computeStructuralFingerprint,
    computeIconSourceFingerprint,
    computeTreeStructuralFingerprint,
    computeTreeIconFingerprint,
    decideFocusTreeUpdate,
} from '../previewdef/focustree/fingerprint';

function structureInput(overrides: Partial<FocusTreeStructureInput> = {}): FocusTreeStructureInput {
    return {
        focusTrees: [{ id: 'tree', focuses: { a: { id: 'a', x: 0, y: 0 } } }],
        renderedFocus: { a: '<div start="1" end="2">a</div>' },
        renderedInlayWindows: {},
        gridBox: { position: { x: 50, y: 50 } },
        useConditionInFocus: false,
        xGridSize: 96,
        styleRecords: {
            'st-focus-common': 'position: relative;',
            'st-focus-icon-goal_a': 'background-color: rgba(127, 127, 127, 0.25);',
        },
        ...overrides,
    };
}

function fingerprints(input: FocusTreeStructureInput) {
    return {
        structural: computeStructuralFingerprint(input),
        iconSource: computeIconSourceFingerprint(input.styleRecords),
    };
}

describe('previewdef/focustree/fingerprint', () => {
    describe('computeStructuralFingerprint', () => {
        it('is stable for identical inputs', () => {
            assert.strictEqual(computeStructuralFingerprint(structureInput()), computeStructuralFingerprint(structureInput()));
        });

        it('changes when the rendered focus HTML changes', () => {
            const before = computeStructuralFingerprint(structureInput());
            const after = computeStructuralFingerprint(structureInput({ renderedFocus: { a: '<div start="1" end="2">a renamed</div>' } }));
            assert.notStrictEqual(before, after);
        });

        it('changes when focus tree data (e.g. a position) changes', () => {
            const before = computeStructuralFingerprint(structureInput());
            const after = computeStructuralFingerprint(structureInput({ focusTrees: [{ id: 'tree', focuses: { a: { id: 'a', x: 3, y: 0 } } }] }));
            assert.notStrictEqual(before, after);
        });

        it('changes when a structure-only style record changes', () => {
            const before = computeStructuralFingerprint(structureInput());
            const after = computeStructuralFingerprint(structureInput({
                styleRecords: { 'st-focus-common': 'position: absolute;', 'st-focus-icon-goal_a': 'background-color: rgba(127, 127, 127, 0.25);' },
            }));
            assert.notStrictEqual(before, after);
        });

        it('is independent of record insertion order (the 8-way render varies it)', () => {
            const inOrder = computeStructuralFingerprint(structureInput({
                renderedFocus: { a: 'A', b: 'B' },
                renderedInlayWindows: { w1: 'W1', w2: 'W2' },
                styleRecords: { 'st-focus-common': 'position: relative;', 'st-focus-icon-goal_a': 'x' },
            }));
            const reversed = computeStructuralFingerprint(structureInput({
                renderedFocus: { b: 'B', a: 'A' },
                renderedInlayWindows: { w2: 'W2', w1: 'W1' },
                styleRecords: { 'st-focus-icon-goal_a': 'x', 'st-focus-common': 'position: relative;' },
            }));
            assert.strictEqual(inOrder, reversed);
        });
    });

    describe('computeIconSourceFingerprint', () => {
        it('only accounts for icon-identity keys, not structural style values', () => {
            const before = computeIconSourceFingerprint({ 'st-focus-common': 'position: relative;', 'st-focus-icon-goal_a': 'x' });
            const after = computeIconSourceFingerprint({ 'st-focus-common': 'position: absolute;', 'st-focus-icon-goal_a': 'x' });
            assert.strictEqual(before, after);
        });

        it('is independent of the resolved icon CSS value (identity only)', () => {
            const placeholder = computeIconSourceFingerprint({ 'st-focus-icon-goal_a': 'background-color: rgba(127, 127, 127, 0.25);' });
            const resolved = computeIconSourceFingerprint({ 'st-focus-icon-goal_a': 'background-image: url(data:image/png;base64,AAAA);' });
            assert.strictEqual(placeholder, resolved);
        });

        it('is independent of key ordering', () => {
            const a = computeIconSourceFingerprint({ 'st-focus-icon-b': '1', 'st-focus-icon-a': '2' });
            const b = computeIconSourceFingerprint({ 'st-focus-icon-a': '2', 'st-focus-icon-b': '1' });
            assert.strictEqual(a, b);
        });

        it('changes when a focus icon identity is added', () => {
            const before = computeIconSourceFingerprint({ 'st-focus-icon-goal_a': 'x' });
            const after = computeIconSourceFingerprint({ 'st-focus-icon-goal_a': 'x', 'st-focus-icon-goal_b': 'y' });
            assert.notStrictEqual(before, after);
        });

        it('accounts for titlebar, overlay and inlay-gfx identities', () => {
            const before = computeIconSourceFingerprint({ 'st-focus-titlebar-t': 'x' });
            assert.notStrictEqual(before, computeIconSourceFingerprint({ 'st-focus-overlay-o': 'x' }));
            assert.notStrictEqual(before, computeIconSourceFingerprint({ 'st-inlay-gfx-g': 'x' }));
        });

        it('changes when an inlay-gui-slot geometry class is added, so the CSS repush covers its rule', () => {
            const before = computeIconSourceFingerprint({ 'st-inlay-gfx-g': 'x', 'st-inlay-gui-slot-3': 'left: 10px;' });
            const after = computeIconSourceFingerprint({ 'st-inlay-gfx-g': 'x', 'st-inlay-gui-slot-3': 'left: 10px;', 'st-inlay-gui-slot-4': 'left: 20px;' });
            assert.notStrictEqual(before, after);
        });
    });

    function treeObjectInput(overrides: Partial<FocusTreeObjectStructureInput> = {}): FocusTreeObjectStructureInput {
        return {
            focusTrees: [{
                id: 'tree',
                focuses: {
                    a: { id: 'a', x: 0, y: 0, icon: [{ icon: 'GFX_a' }], textIcon: 'GFX_t', overlay: 'GFX_o', token: { start: 10, end: 20 } },
                },
                inlayWindows: [{
                    id: 'w',
                    guiWindow: { name: 'win', size: { width: 100, height: 100 } },
                    scriptedImages: [{ id: 's', gfxOptions: [{ gfxName: 'GFX_slot' }] }],
                }],
            }],
            gridBox: { position: { x: 50, y: 50 } },
            useConditionInFocus: false,
            xGridSize: 96,
            localisationIndex: false,
            previewLocalisation: '',
            ...overrides,
        };
    }

    describe('computeTreeStructuralFingerprint', () => {
        it('is stable for identical inputs', () => {
            assert.strictEqual(computeTreeStructuralFingerprint(treeObjectInput()), computeTreeStructuralFingerprint(treeObjectInput()));
        });

        it('changes when a focus token moves (navigation offset shift)', () => {
            const before = computeTreeStructuralFingerprint(treeObjectInput());
            const after = computeTreeStructuralFingerprint(treeObjectInput({
                focusTrees: [{ id: 'tree', focuses: { a: { id: 'a', x: 0, y: 0, icon: [{ icon: 'GFX_a' }], token: { start: 11, end: 21 } } }, inlayWindows: [] }],
            }));
            assert.notStrictEqual(before, after);
        });

        it('changes when focus tree data (e.g. a position) changes', () => {
            const before = computeTreeStructuralFingerprint(treeObjectInput());
            const after = computeTreeStructuralFingerprint(treeObjectInput({
                focusTrees: [{ id: 'tree', focuses: { a: { id: 'a', x: 3, y: 0, icon: [{ icon: 'GFX_a' }], token: { start: 10, end: 20 } } }, inlayWindows: [] }],
            }));
            assert.notStrictEqual(before, after);
        });

        it('changes when a tree gains a warning (so the update path re-renders)', () => {
            const before = computeTreeStructuralFingerprint(treeObjectInput());
            const after = computeTreeStructuralFingerprint(treeObjectInput({
                focusTrees: [{
                    id: 'tree',
                    focuses: { a: { id: 'a', x: 0, y: 0, icon: [{ icon: 'GFX_a' }], token: { start: 10, end: 20 } } },
                    inlayWindows: [],
                    warnings: [{ text: 'Focuses a and b overlap.', source: 'a', relatedSources: ['b'] }],
                }],
            }));
            assert.notStrictEqual(before, after);
        });

        it('is EQUAL when only an inlay guiWindow subtree changes (guiWindow is excluded)', () => {
            const before = computeTreeStructuralFingerprint(treeObjectInput());
            const after = computeTreeStructuralFingerprint(treeObjectInput({
                focusTrees: [{
                    id: 'tree',
                    focuses: {
                        a: { id: 'a', x: 0, y: 0, icon: [{ icon: 'GFX_a' }], textIcon: 'GFX_t', overlay: 'GFX_o', token: { start: 10, end: 20 } },
                    },
                    inlayWindows: [{
                        id: 'w',
                        // A completely different, larger guiWindow subtree resolved from the .gui dependency.
                        guiWindow: { name: 'win', size: { width: 999, height: 999 }, children: [{ name: 'x' }, { name: 'y' }] },
                        scriptedImages: [{ id: 's', gfxOptions: [{ gfxName: 'GFX_slot' }] }],
                    }],
                }],
            }));
            assert.strictEqual(before, after);
        });

        it('changes when the localisation index flag toggles (same trees)', () => {
            // A config flip does not reload the preview, so the fingerprint must move to block a stale skip.
            const before = computeTreeStructuralFingerprint(treeObjectInput({ localisationIndex: false }));
            const after = computeTreeStructuralFingerprint(treeObjectInput({ localisationIndex: true }));
            assert.notStrictEqual(before, after);
        });

        it('changes when the preview localisation language changes (same trees)', () => {
            const before = computeTreeStructuralFingerprint(treeObjectInput({ localisationIndex: true, previewLocalisation: 'English' }));
            const after = computeTreeStructuralFingerprint(treeObjectInput({ localisationIndex: true, previewLocalisation: 'French' }));
            assert.notStrictEqual(before, after);
        });
    });

    describe('computeTreeIconFingerprint', () => {
        it('is stable for the same icon identities', () => {
            assert.strictEqual(computeTreeIconFingerprint(treeObjectInput().focusTrees as any), computeTreeIconFingerprint(treeObjectInput().focusTrees as any));
        });

        it('is independent of tree/focus ordering', () => {
            const a = computeTreeIconFingerprint([
                { focuses: { a: { icon: [{ icon: 'GFX_a' }] }, b: { icon: [{ icon: 'GFX_b' }] } } },
            ] as any);
            const b = computeTreeIconFingerprint([
                { focuses: { b: { icon: [{ icon: 'GFX_b' }] }, a: { icon: [{ icon: 'GFX_a' }] } } },
            ] as any);
            assert.strictEqual(a, b);
        });

        it('changes when a focus icon name changes', () => {
            const before = computeTreeIconFingerprint(treeObjectInput().focusTrees as any);
            const after = computeTreeIconFingerprint([{
                id: 'tree',
                focuses: { a: { id: 'a', icon: [{ icon: 'GFX_renamed' }], textIcon: 'GFX_t', overlay: 'GFX_o' } },
                inlayWindows: [{ id: 'w', scriptedImages: [{ id: 's', gfxOptions: [{ gfxName: 'GFX_slot' }] }] }],
            }] as any);
            assert.notStrictEqual(before, after);
        });

        it('changes when an inlay gfx name changes', () => {
            const before = computeTreeIconFingerprint(treeObjectInput().focusTrees as any);
            const after = computeTreeIconFingerprint([{
                id: 'tree',
                focuses: { a: { id: 'a', icon: [{ icon: 'GFX_a' }], textIcon: 'GFX_t', overlay: 'GFX_o' } },
                inlayWindows: [{ id: 'w', scriptedImages: [{ id: 's', gfxOptions: [{ gfxName: 'GFX_slot_changed' }] }] }],
            }] as any);
            assert.notStrictEqual(before, after);
        });

        it('keeps icon and overlay of the same name distinct (category prefixes)', () => {
            const asIcon = computeTreeIconFingerprint([{ focuses: { a: { icon: [{ icon: 'GFX_x' }] } } }] as any);
            const asOverlay = computeTreeIconFingerprint([{ focuses: { a: { overlay: 'GFX_x' } } }] as any);
            assert.notStrictEqual(asIcon, asOverlay);
        });
    });

    describe('decideFocusTreeUpdate', () => {
        it('posts an update and resolves icons on the first render (no prior fingerprints)', () => {
            assert.deepStrictEqual(decideFocusTreeUpdate(undefined, fingerprints(structureInput())), { postUpdate: true, pushIcons: true });
        });

        it('skips when identical structure-only payloads produce the same fingerprints', () => {
            const prev = fingerprints(structureInput());
            const next = fingerprints(structureInput());
            assert.deepStrictEqual(decideFocusTreeUpdate(prev, next), { postUpdate: false, pushIcons: false });
        });

        it('posts an update but not an icon push when only rendered focus HTML changes', () => {
            const prev = fingerprints(structureInput());
            const next = fingerprints(structureInput({ renderedFocus: { a: '<div start="1" end="2">a renamed</div>' } }));
            assert.deepStrictEqual(decideFocusTreeUpdate(prev, next), { postUpdate: true, pushIcons: false });
        });

        it('pushes icons when a focus icon identity is added', () => {
            // Adding an icon changes both the focus data (structural) and the icon set.
            const prev = fingerprints(structureInput());
            const next = fingerprints(structureInput({
                styleRecords: { 'st-focus-common': 'position: relative;', 'st-focus-icon-goal_a': 'x', 'st-focus-icon-goal_b': 'y' },
            }));
            const decision = decideFocusTreeUpdate(prev, next);
            assert.strictEqual(decision.pushIcons, true);
        });

        it('flags both when structure and icon identities both change', () => {
            const prev = fingerprints(structureInput());
            const next = fingerprints(structureInput({
                renderedFocus: { a: '<div start="1" end="2">a renamed</div>' },
                styleRecords: { 'st-focus-common': 'position: relative;', 'st-focus-icon-goal_c': 'z' },
            }));
            assert.deepStrictEqual(decideFocusTreeUpdate(prev, next), { postUpdate: true, pushIcons: true });
        });
    });
});
