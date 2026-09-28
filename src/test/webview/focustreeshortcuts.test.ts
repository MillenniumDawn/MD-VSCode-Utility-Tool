import { loadEntrypoint } from './setup';
import * as assert from 'assert';
import { FocusTree, FocusTreeShortcut } from '../../previewdef/focustree/schema';

// focustree.ts reads window.focusTrees at module scope; the tests drive the exported helpers against
// a toolbar built the way the content builder builds it.
(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

const { renderShortcuts, bindShortcuts } = focustree;

function treeWith(shortcuts: FocusTreeShortcut[] | undefined): FocusTree {
    return { shortcuts } as FocusTree;
}

function toolbar(): { container: HTMLDivElement; select: HTMLSelectElement } {
    document.body.innerHTML = `
        <div id="shortcut-container">
            <select id="shortcuts"></select>
        </div>`;
    return {
        container: document.getElementById('shortcut-container') as HTMLDivElement,
        select: document.getElementById('shortcuts') as HTMLSelectElement,
    };
}

function focusNode(id: string): { node: HTMLElement; scrolled: () => number } {
    const node = document.createElement('div');
    node.id = 'focus_' + id;
    let count = 0;
    node.scrollIntoView = () => {
        count++;
    };
    document.body.appendChild(node);
    return { node, scrolled: () => count };
}

function pick(select: HTMLSelectElement, value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
}

describe('webview/focustree shortcuts', () => {
    it('hides the control on a tree without shortcuts', () => {
        const { container } = toolbar();
        renderShortcuts(treeWith(undefined));
        assert.strictEqual(container.style.display, 'none');
        renderShortcuts(treeWith([]));
        assert.strictEqual(container.style.display, 'none');
    });

    it('lists the shortcuts in file order behind a placeholder, localised where it can', () => {
        const { container, select } = toolbar();
        renderShortcuts(treeWith([
            { name: 'AFG_government_shortcut', target: 'AFG_the_islamic_republic' },
            { name: 'AFG_civil_war_shortcut', target: 'AFG_civil_war' },
        ]), { AFG_government_shortcut: 'Government' });
        assert.strictEqual(container.style.display, 'block');
        assert.deepStrictEqual(
            [...select.options].map(o => [o.value, o.textContent]),
            [['', 'Jump to…'], ['0', 'Government'], ['1', 'AFG_civil_war_shortcut']],
        );
        assert.strictEqual(select.value, '');
    });

    it('escapes a shortcut name', () => {
        const { select } = toolbar();
        renderShortcuts(treeWith([{ name: '<b>x</b>', target: 'a' }]));
        assert.strictEqual(select.options[1].textContent, '<b>x</b>');
        assert.strictEqual(select.querySelector('b'), null);
    });

    it('scrolls to the target focus and returns to the placeholder, so the same shortcut can be picked again', () => {
        const { select } = toolbar();
        const tree = treeWith([
            { name: 'first', target: 'TST_a' },
            { name: 'second', target: 'TST_b' },
        ]);
        renderShortcuts(tree);
        bindShortcuts(select, () => tree);
        const a = focusNode('TST_a');
        const b = focusNode('TST_b');

        pick(select, '1');
        assert.strictEqual(b.scrolled(), 1);
        assert.strictEqual(a.scrolled(), 0);
        assert.strictEqual(select.value, '');

        pick(select, '1');
        assert.strictEqual(b.scrolled(), 2);
    });

    it('does nothing for the placeholder or a target the tree does not draw', () => {
        const { select } = toolbar();
        const tree = treeWith([
            { name: 'first', target: 'TST_a' },
            { name: 'hidden', target: 'TST_hidden' },
        ]);
        renderShortcuts(tree);
        bindShortcuts(select, () => tree);
        const a = focusNode('TST_a');

        pick(select, '');
        pick(select, '1');
        assert.strictEqual(a.scrolled(), 0);
        assert.strictEqual(select.value, '');
    });
});
