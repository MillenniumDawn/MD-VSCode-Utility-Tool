import { loadEntrypoint } from './setup';
import * as assert from 'assert';
import { FocusTree, FocusTreeShortcut } from '../../previewdef/focustree/schema';

// focustree.ts reads window.focusTrees at module scope; the tests drive the exported helpers against
// an overlay built the way the content builder builds it.
(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

const { renderShortcuts, bindShortcuts } = focustree;

function treeWith(shortcuts: FocusTreeShortcut[] | undefined): FocusTree {
    return { shortcuts } as FocusTree;
}

// What the host renders for one shortcut, reduced to the attribute the webview reads.
function button(index: number, label: string): string {
    return `<div data-shortcut-index="${index}"><div class="name">${label}</div></div>`;
}

function overlay(): { overlay: HTMLDivElement; list: HTMLDivElement; toggle: HTMLButtonElement } {
    document.body.innerHTML = `
        <div id="shortcut-overlay" style="display:none">
            <div id="shortcut-list"></div>
            <button id="shortcut-toggle"><i class="codicon"></i></button>
        </div>`;
    return {
        overlay: document.getElementById('shortcut-overlay') as HTMLDivElement,
        list: document.getElementById('shortcut-list') as HTMLDivElement,
        toggle: document.getElementById('shortcut-toggle') as HTMLButtonElement,
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

function click(element: Element) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('webview/focustree shortcuts', () => {
    it('hides the overlay on a tree without shortcuts', () => {
        const { overlay: element } = overlay();
        renderShortcuts(treeWith(undefined), []);
        assert.strictEqual(element.style.display, 'none');
        renderShortcuts(treeWith([]), []);
        assert.strictEqual(element.style.display, 'none');
    });

    it('shows the rendered buttons of the tree in file order', () => {
        const { overlay: element, list } = overlay();
        renderShortcuts(treeWith([
            { name: 'AFG_government_shortcut', target: 'AFG_the_islamic_republic' },
            { name: 'AFG_civil_war_shortcut', target: 'AFG_civil_war' },
        ]), [button(0, 'Government'), button(1, 'Civil war')]);
        assert.strictEqual(element.style.display, 'flex');
        assert.deepStrictEqual(
            [...list.querySelectorAll('[data-shortcut-index]')].map(e => [e.getAttribute('data-shortcut-index'), e.textContent]),
            [['0', 'Government'], ['1', 'Civil war']],
        );
    });

    it('replaces the buttons when another tree is shown', () => {
        const { overlay: element, list } = overlay();
        renderShortcuts(treeWith([{ name: 'a', target: 'TST_a' }]), [button(0, 'first tree')]);
        renderShortcuts(treeWith([]), []);
        assert.strictEqual(element.style.display, 'none');
        assert.strictEqual(list.children.length, 0);
    });

    it('scrolls to the target focus of the clicked button, from anywhere inside it', () => {
        const { overlay: element, list } = overlay();
        const tree = treeWith([
            { name: 'first', target: 'TST_a' },
            { name: 'second', target: 'TST_b' },
        ]);
        renderShortcuts(tree, [button(0, 'first'), button(1, 'second')]);
        bindShortcuts(element, () => tree);
        const a = focusNode('TST_a');
        const b = focusNode('TST_b');

        click(list.querySelector('[data-shortcut-index="1"] .name')!);
        assert.strictEqual(b.scrolled(), 1);
        assert.strictEqual(a.scrolled(), 0);

        click(list.querySelector('[data-shortcut-index="1"]')!);
        assert.strictEqual(b.scrolled(), 2);
    });

    it('does nothing for a target the tree does not draw', () => {
        const { overlay: element, list } = overlay();
        const tree = treeWith([
            { name: 'first', target: 'TST_a' },
            { name: 'hidden', target: 'TST_hidden' },
        ]);
        renderShortcuts(tree, [button(0, 'first'), button(1, 'hidden')]);
        bindShortcuts(element, () => tree);
        const a = focusNode('TST_a');

        click(list.querySelector('[data-shortcut-index="1"]')!);
        assert.strictEqual(a.scrolled(), 0);
    });

    it('folds the buttons away and back with the toggle', () => {
        const { overlay: element, toggle } = overlay();
        const tree = treeWith([{ name: 'first', target: 'TST_a' }]);
        renderShortcuts(tree, [button(0, 'first')]);
        bindShortcuts(element, () => tree);
        const a = focusNode('TST_a');

        const initiallyCollapsed = element.classList.contains('collapsed');
        click(toggle.querySelector('i')!);
        assert.strictEqual(element.classList.contains('collapsed'), !initiallyCollapsed);
        click(toggle);
        assert.strictEqual(element.classList.contains('collapsed'), initiallyCollapsed);
        assert.strictEqual(a.scrolled(), 0);
    });
});
