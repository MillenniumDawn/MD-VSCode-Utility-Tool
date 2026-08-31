import { takePostedMessages } from './setup';
import * as assert from 'assert';
import { GridBoxItem } from '../../util/hoi4gui/gridboxcommon';
import { MioTrait } from '../../previewdef/mio/schema';

function trait(id: string, x: number, y: number): MioTrait {
    return {
        id, name: id + '_name', icon: undefined,
        anyParent: [], allParents: [], exclusive: [], parent: undefined,
        x, y, relativePositionId: undefined,
        visible: true, hasVisible: false, specialTraitBackground: false,
        effects: [], token: undefined,
        file: 'common/military_industrial_organization/organizations/test.txt',
        sourceMioId: 'mio_test',
    };
}

// The payload the host renders into the page, including window.previewOptions -- how the host hands
// back the toolbar positions the reader last chose. "Show grid" is stored on here, against its own
// default of off, so the rendering suite proves the stored value is what wins.
//
// Installed twice: once before the require below, because miopreview.ts reads the toggles and the
// organization list at module scope; and again when the page is rendered, because every webview
// test file shares one window and a preview module loaded in the same run reassigns these globals
// from any `updateBody` message dispatched at it -- focustree.ts takes window.gridBox that way.
function installPayload(): void {
    (global as any).window.mios = [{
        id: 'mio_test',
        traits: { alpha: trait('alpha', 0, 0), beta: trait('beta', 1, 0) },
        textHeaders: [],
        conditionExprs: [],
        warnings: [],
    }];
    (global as any).window.renderedTrait = { mio_test: { alpha: '<span>alpha</span>', beta: '<span>beta</span>' } };
    (global as any).window.renderedHeaders = { mio_test: '' };
    (global as any).window.gridBox = {
        position: { x: { _value: 50 }, y: { _value: 50 } },
        format: { _name: 'up' },
        size: { width: { _value: 87 } },
        slotsize: { width: { _value: 87 }, height: { _value: 117 } },
    };
    (global as any).window.xGridSize = 87;
    (global as any).window.toolbarHeight = 52;
    (global as any).window.previewOptions = { 'mio.showGrid': true };
}

installPayload();

// The shell the host renders. Installed from the rendering suite's before hook rather than at module
// scope: every webview test file shares one jsdom document, and writing body.innerHTML here would
// clobber whichever other file's fixture happened to load after this one.
const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <div id="mio-select-container">
            <div class="select-container">
                <select id="mios" class="select multiple-select" tabindex="0" role="combobox">
                    <option value="0">mio_test</option>
                </select>
            </div>
        </div>
        <div id="condition-container">
            <div class="select-container">
                <div id="conditions" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>
        <label for="show-included-traits">Show inherited traits</label>
        <input type="checkbox" id="show-included-traits">
        <label for="show-grid">Show grid</label>
        <input type="checkbox" id="show-grid">
        <label for="show-overlaps">Show overlapping traits</label>
        <input type="checkbox" id="show-overlaps">
    </div></div>
    <div id="miopreviewcontent"><div id="miopreviewplaceholder"></div></div>`;

const { findOverlaps } = require('../../../webviewsrc/miopreview') as typeof import('../../../webviewsrc/miopreview');

function item(id: string, gridX: number, gridY: number): GridBoxItem {
    return { id, gridX, gridY, connections: [] };
}

describe('webview/miopreview findOverlaps', () => {
    it('returns nothing when every trait has its own slot', () => {
        assert.deepStrictEqual(findOverlaps([item('a', 0, 0), item('b', 1, 0), item('c', 0, 1)]), []);
    });

    it('reports a cell holding two traits', () => {
        assert.deepStrictEqual(findOverlaps([item('a', 3, 2), item('b', 3, 2)]), [{ x: 3, y: 2, count: 2 }]);
    });

    it('counts every trait stacked on the same cell', () => {
        assert.deepStrictEqual(
            findOverlaps([item('a', 1, 1), item('b', 1, 1), item('c', 1, 1)]),
            [{ x: 1, y: 1, count: 3 }]);
    });

    it('reports each colliding cell separately and leaves clean cells out', () => {
        const overlaps = findOverlaps([
            item('a', 0, 0), item('b', 0, 0),
            item('c', 2, 0),
            item('d', 4, 5), item('e', 4, 5),
        ]);

        assert.deepStrictEqual(overlaps, [{ x: 0, y: 0, count: 2 }, { x: 4, y: 5, count: 2 }]);
    });

    it('does not confuse a shared x or a shared y with a collision', () => {
        assert.deepStrictEqual(findOverlaps([item('a', 2, 0), item('b', 2, 1), item('c', 3, 1)]), []);
    });

    it('handles negative columns, which the preview supports', () => {
        assert.deepStrictEqual(findOverlaps([item('a', -1, 0), item('b', -1, 0)]), [{ x: -1, y: 0, count: 2 }]);
    });

    it('returns nothing for an empty tree', () => {
        assert.deepStrictEqual(findOverlaps([]), []);
    });
});

// The toolbar as the reader meets it: wired into the page, not a detached element a builder handed
// back. buildContent is async, so every step waits a macrotask for it to settle.
describe('webview/miopreview rendering', () => {
    function placeholder(): HTMLElement {
        const element = document.getElementById('miopreviewplaceholder');
        assert.ok(element, 'expected the shell placeholder element');
        return element!;
    }

    function checkbox(id: string): HTMLInputElement {
        const input = document.getElementById(id) as HTMLInputElement | null;
        assert.ok(input, `expected the ${id} checkbox`);
        return input!;
    }

    const settled = () => new Promise(resolve => setTimeout(resolve, 0));

    let previousBody = '';

    before(async () => {
        previousBody = document.body.innerHTML;
        installPayload();
        document.body.innerHTML = shellHtml;
        // The module binds its toolbar and its renderer to window load, as the webview does.
        window.dispatchEvent(new (window as any).Event('load'));
        await settled();
        takePostedMessages();
    });

    after(() => {
        document.body.innerHTML = previousBody;
    });

    it('draws the tree the payload describes', () => {
        assert.strictEqual(placeholder().querySelectorAll('.trait').length, 2);
    });

    // The grid defaults to off, so a grid on screen can only have come from the stored option.
    it('restores a toggle the host had stored, against the toggle own default', () => {
        assert.ok(placeholder().querySelector('.st-mio-grid-line'), 'expected the stored grid overlay');
        assert.strictEqual(checkbox('show-grid').checked, true);
    });

    // enableCheckboxes builds the widget from the unrestored value, so without the sync the box the
    // reader actually sees -- and what a screen reader announces -- disagrees with the grid on screen.
    it('puts the codicon widget over the box in step with the restored value', () => {
        const widget = checkbox('show-grid').nextElementSibling?.querySelector('.checkbox-container');
        assert.ok(widget, 'expected the widget Checkbox.init inserted after the input');
        assert.strictEqual(widget!.getAttribute('aria-checked'), 'true');
    });

    // A toggle nothing was stored for keeps the default it has always had.
    it('leaves a toggle the host stored nothing for on its default', () => {
        assert.strictEqual(checkbox('show-included-traits').checked, true);
        assert.strictEqual(checkbox('show-overlaps').checked, true);
    });

    it('sends a click to the host so the position outlives the panel, and redraws', async () => {
        const input = checkbox('show-grid');
        input.checked = false;
        input.dispatchEvent(new (window as any).Event('change'));
        await settled();

        assert.deepStrictEqual(takePostedMessages(), [
            { command: 'setPreviewOption', key: 'mio.showGrid', value: false },
        ]);
        assert.strictEqual(placeholder().querySelector('.st-mio-grid-line'), null);
    });
});
