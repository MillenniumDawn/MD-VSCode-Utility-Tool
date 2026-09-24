import { loadEntrypoint } from './setup';
import * as assert from 'assert';
import { FocusTree } from '../../previewdef/focustree/schema';

(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

const { placeContinuousFocuses } = focustree;

function tree(x: number | undefined, y: number | undefined): FocusTree {
    return { continuousFocusPositionX: x, continuousFocusPositionY: y } as FocusTree;
}

describe('webview/focustree placeContinuousFocuses', () => {
    it('places the box at continuous_focus_position with the layout size', () => {
        const box = document.createElement('div');
        placeContinuousFocuses(box, tree(100, 900), { width: 600, height: 300 });
        assert.strictEqual(box.style.left, '41px');
        assert.strictEqual(box.style.top, '907px');
        assert.strictEqual(box.style.width, '600px');
        assert.strictEqual(box.style.height, '300px');
        assert.strictEqual(box.style.display, 'block');
    });

    it('keeps the game size when the page carries none', () => {
        const box = document.createElement('div');
        placeContinuousFocuses(box, tree(50, 1000), undefined);
        assert.strictEqual(box.style.width, '770px');
        assert.strictEqual(box.style.height, '380px');
    });

    it('takes a new size on the next placement', () => {
        const box = document.createElement('div');
        placeContinuousFocuses(box, tree(50, 1000), { width: 600, height: 300 });
        placeContinuousFocuses(box, tree(50, 1000), { width: 700, height: 350 });
        assert.strictEqual(box.style.width, '700px');
        assert.strictEqual(box.style.height, '350px');
    });

    it('hides the box when the tree has no position', () => {
        const box = document.createElement('div');
        placeContinuousFocuses(box, tree(undefined, undefined), { width: 600, height: 300 });
        assert.strictEqual(box.style.display, 'none');
    });
});
