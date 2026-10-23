import { loadEntrypoint } from './setup';
import * as assert from 'assert';

(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

function focus(id: string): HTMLDivElement {
    const element = document.createElement('div');
    element.id = `focus_${id}`;
    element.className = 'focus';
    return element;
}

describe('webview/focustree search matching', () => {
    it('matches the focus id without its prefix, case-insensitively', () => {
        assert.strictEqual(focustree.matchesFocusSearch(focus('ENG_Navy'), 'navy'), true);
        assert.strictEqual(focustree.matchesFocusSearch(focus('ENG_Navy'), 'focus_eng'), false);
        assert.strictEqual(focustree.matchesFocusSearch(focus('ENG_Navy'), 'army'), false);
    });
});
