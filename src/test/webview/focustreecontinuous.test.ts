import { loadEntrypoint, takePostedMessages, resetWebviewState } from './setup';
import * as assert from 'assert';
import { FocusTree } from '../../previewdef/focustree/schema';

(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

const { placeContinuousFocuses, wireContinuousFocusEditing } = focustree;

function tree(x: number | undefined, y: number | undefined): FocusTree {
    return { continuousFocusPositionX: x, continuousFocusPositionY: y } as FocusTree;
}

describe('webview/focustree placeContinuousFocuses', () => {
    const win = window as any;
    let box: HTMLElement;

    beforeEach(() => {
        box = document.createElement('div');
        box.id = 'continuousFocuses';
        document.body.replaceChildren(box);
        win.continuousFocusSize = { width: 600, height: 300 };
    });

    afterEach(() => {
        document.body.replaceChildren();
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
        document.body.replaceChildren();
        assert.doesNotThrow(() => placeContinuousFocuses(tree(50, 1000)));
    });
});

describe('webview/focustree continuous focus dragging', () => {
    const source = { file: 'common/national_focus/test.txt', start: 12 };
    let box: HTMLElement;
    let button: HTMLElement;
    let current: FocusTree;

    function editableTree(x: number, y: number): FocusTree {
        return { id: 'test_tree', continuousFocusPositionX: x, continuousFocusPositionY: y, continuousFocusSource: source } as FocusTree;
    }

    function mouse(target: EventTarget, type: string, clientX: number, clientY: number) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }));
    }

    function drag(fromX: number, fromY: number, toX: number, toY: number) {
        mouse(box, 'mousedown', fromX, fromY);
        mouse(document, 'mousemove', toX, toY);
        mouse(document, 'mouseup', toX, toY);
    }

    beforeEach(() => {
        resetWebviewState();
        button = document.createElement('button');
        button.id = 'edit-continuous-focus';
        box = document.createElement('div');
        box.id = 'continuousFocuses';
        document.body.replaceChildren(button, box);
        current = editableTree(100, 900);
        wireContinuousFocusEditing(() => current);
        placeContinuousFocuses(current);
    });

    afterEach(() => {
        document.body.replaceChildren();
        resetWebviewState();
    });

    it('posts nothing while the toggle is off', () => {
        assert.strictEqual(box.classList.contains('continuous-editable'), false);
        drag(10, 10, 60, 90);
        assert.deepStrictEqual(takePostedMessages(), []);
        assert.strictEqual(box.style.left, '41px');
    });

    it('writes the dropped position back once the toggle is on', () => {
        button.click();
        assert.strictEqual(box.classList.contains('continuous-editable'), true);
        drag(10, 10, 60, 90);
        assert.deepStrictEqual(takePostedMessages(), [
            { command: 'setContinuousFocusPosition', file: source.file, start: source.start, treeId: 'test_tree', x: 150, y: 980 },
        ]);
        assert.strictEqual(box.style.left, '91px');
        assert.strictEqual(box.style.top, '987px');
    });

    it('divides the pointer movement by the zoom', () => {
        button.click();
        const vscodeState = (global as any).acquireVsCodeApi().getState();
        vscodeState.scale = 0.5;
        drag(10, 10, 60, 90);
        const [msg] = takePostedMessages();
        assert.strictEqual(msg.x, 200);
        assert.strictEqual(msg.y, 1060);
    });

    it('treats a press that barely moves as a click', () => {
        button.click();
        drag(10, 10, 12, 13);
        assert.deepStrictEqual(takePostedMessages(), []);
    });

    it('keeps the pan layer from seeing a press on the box', () => {
        button.click();
        let reached = false;
        document.body.addEventListener('mousedown', () => { reached = true; });
        mouse(box, 'mousedown', 10, 10);
        mouse(document, 'mouseup', 10, 10);
        assert.strictEqual(reached, false);
    });

    it('hides the toggle on a tree the file does not define', () => {
        current = { continuousFocusPositionX: 50, continuousFocusPositionY: 1000 } as FocusTree;
        placeContinuousFocuses(current);
        assert.strictEqual(button.style.display, 'none');
        button.click();
        assert.strictEqual(box.classList.contains('continuous-editable'), false);
    });
});
