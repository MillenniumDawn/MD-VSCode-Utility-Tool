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
    const win = window as any;
    let box: HTMLElement;

    beforeEach(() => {
        document.body.innerHTML = '<div id="continuousFocuses"></div>';
        box = document.getElementById('continuousFocuses')!;
        win.continuousFocusSize = { width: 600, height: 300 };
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete win.continuousFocusSize;
    });

    it('places the box at continuous_focus_position with the layout size', () => {
        placeContinuousFocuses(tree(100, 900));
        assert.strictEqual(box.style.left, '41px');
        assert.strictEqual(box.style.top, '907px');
        assert.strictEqual(box.style.width, '600px');
        assert.strictEqual(box.style.height, '300px');
        assert.strictEqual(box.style.display, 'block');
    });

    it('keeps the game size when the page carries none', () => {
        delete win.continuousFocusSize;
        placeContinuousFocuses(tree(50, 1000));
        assert.strictEqual(box.style.width, '770px');
        assert.strictEqual(box.style.height, '380px');
    });

    it('takes a new size on the next placement', () => {
        placeContinuousFocuses(tree(50, 1000));
        win.continuousFocusSize = { width: 700, height: 350 };
        placeContinuousFocuses(tree(50, 1000));
        assert.strictEqual(box.style.width, '700px');
        assert.strictEqual(box.style.height, '350px');
    });

    it('hides the box when the tree has no position', () => {
        placeContinuousFocuses(tree(undefined, undefined));
        assert.strictEqual(box.style.display, 'none');
    });

    it('does nothing when the page has no continuous focus box', () => {
        document.body.innerHTML = '';
        assert.doesNotThrow(() => placeContinuousFocuses(tree(50, 1000)));
    });
});
