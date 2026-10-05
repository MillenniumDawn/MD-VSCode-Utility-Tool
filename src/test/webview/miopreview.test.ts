import { takePostedMessages, loadEntrypoint, useEntrypoint } from './setup';
import * as assert from 'assert';
import { GridBoxItem } from '../../util/hoi4gui/gridboxcommon';
import { MioTrait } from '../../previewdef/mio/schema';
import { warningBoxClass, warningEntryClass } from '../../util/hoi4gui/warningstyles';
import { traceDimClass, traceLineClass } from '../../util/hoi4gui/tracestyles';

function trait(id: string, x: number, y: number, allParents: string[] = []): MioTrait {
    return {
        id, name: id + '_name', icon: undefined,
        anyParent: [], allParents, exclusive: [], parent: undefined,
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
// organization list at module scope; and again when the page is rendered, so the suite draws from
// its own payload whatever another file left on the shared window.
const hostileCondition = `has_country_flag = "x'"><img src=x onerror=alert(1)>"`;

function installPayload(): void {
    (global as any).window.mios = [{
        id: 'mio_test',
        // beta and gamma both take alpha as their parent, so tracing one has a line to light and a
        // line to dim.
        traits: { alpha: trait('alpha', 0, 1), beta: trait('beta', 1, 0, ['alpha']), gamma: trait('gamma', 2, 2, ['alpha']) },
        textHeaders: [],
        // A trigger as a mod could write it, with the characters that would break out of the
        // option markup the filter lists it in.
        conditionExprs: [{ scopeName: 'ROOT', nodeContent: hostileCondition }],
        warnings: [{ text: 'Parent alpha of trait beta is not positioned above it.', source: 'beta', relatedSources: ['alpha'] }],
    }];
    const card = (id: string) => `<div class="navigator" start="1" end="2" title="${id}">${id}</div>`;
    (global as any).window.renderedTrait = { mio_test: { alpha: card('alpha'), beta: card('beta'), gamma: card('gamma') } };
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
        <div class="toolbar-actions">
            <button id="show-warnings" type="button" aria-pressed="false"><i class="codicon codicon-warning"></i></button>
            <button id="toggle-warning-markers" type="button" aria-pressed="true"><i class="codicon codicon-circle-large-filled"></i></button>
            <button id="copy-warnings" type="button"><i class="codicon codicon-copy"></i></button>
            <div id="trace-status-container" style="display:none">
                <span id="trace-status"></span>
                <button id="clear-trace" type="button"><i class="codicon codicon-close"></i></button>
            </div>
        </div>
    </div></div>
    <div id="dragger"></div>
    <div id="miopreviewcontent"><div id="miopreviewplaceholder"></div></div>
    <div id="warnings-container" style="display:none"><div id="warnings"></div></div>`;

const { module: { findOverlaps }, listeners } = loadEntrypoint(
    () => require('../../../webviewsrc/miopreview') as typeof import('../../../webviewsrc/miopreview'),
);

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
    useEntrypoint(listeners);

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
        assert.strictEqual(placeholder().querySelectorAll('.trait').length, 3);
    });

    // Both ends of the warning are marked, and say why on hover.
    it('marks the traits a warning names, with the warning on their tooltip', () => {
        for (const id of ['alpha', 'beta']) {
            const node = document.getElementById('trait_' + id)!;
            assert.ok(node.querySelector('.' + warningBoxClass), `expected a marker on ${id}`);
            const title = (node.querySelector('.navigator') as HTMLElement).title;
            assert.ok(title.includes('⚠ Parent alpha of trait beta is not positioned above it.'), title);
        }
        assert.strictEqual(document.getElementById('trait_gamma')!.querySelector('.' + warningBoxClass), null);
    });

    it('hides and shows the markers from the toolbar', () => {
        const button = document.getElementById('toggle-warning-markers')!;
        const marker = () => document.getElementById('trait_beta')!.querySelector('.' + warningBoxClass) as HTMLElement;
        button.click();
        assert.strictEqual(marker().style.display, 'none');
        assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
        button.click();
        assert.strictEqual(marker().style.display, 'block');
    });

    it('lists the warnings in the panel the toolbar opens', () => {
        const container = document.getElementById('warnings-container')!;
        const entries = container.querySelectorAll('.' + warningEntryClass);
        assert.deepStrictEqual([...entries].map(e => e.textContent), [
            '[beta] Parent alpha of trait beta is not positioned above it.',
        ]);

        document.getElementById('show-warnings')!.click();
        assert.strictEqual(container.style.display, 'block');
        // An entry closes the panel to show the trait it is about. jsdom does no layout, so the
        // scroll is caught on the element.
        let scrolled = false;
        document.getElementById('trait_beta')!.scrollIntoView = () => { scrolled = true; };
        (entries[0] as HTMLElement).click();
        assert.strictEqual(container.style.display, 'none');
        assert.ok(scrolled, 'expected the entry to scroll its trait into view');
    });

    it('sends the warnings of the organization on screen to the host to copy', () => {
        takePostedMessages();
        document.getElementById('copy-warnings')!.click();
        assert.deepStrictEqual(takePostedMessages(), [{
            command: 'copyWarnings',
            treeId: 'mio_test',
            warnings: [{ source: 'beta', text: 'Parent alpha of trait beta is not positioned above it.' }],
        }]);
    });

    it('traces the parent lines of a shift+clicked trait, without jumping to its definition', () => {
        takePostedMessages();
        const navigator = document.getElementById('trait_beta')!.querySelector('.navigator') as HTMLElement;
        navigator.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));

        assert.deepStrictEqual(takePostedMessages(), [], 'a traced click must not navigate');
        const lines = [...placeholder().querySelectorAll('[data-conn-from]')] as HTMLElement[];
        const lit = lines.filter(l => l.classList.contains(traceLineClass));
        assert.ok(lit.length > 0, 'expected the parent line of beta to be lit');
        assert.ok(lit.every(l => l.dataset.connFrom === 'beta'));
        const gammaLines = lines.filter(l => l.dataset.connFrom === 'gamma');
        assert.ok(gammaLines.length > 0 && gammaLines.every(l => l.classList.contains(traceDimClass)));
        assert.strictEqual(document.getElementById('trace-status')!.textContent, 'Tracing: beta');
        assert.strictEqual(document.getElementById('trace-status-container')!.style.display, 'flex');
    });

    it('clears the trace on Escape', () => {
        window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'Escape' }));
        assert.strictEqual(placeholder().querySelectorAll('.' + traceLineClass + ', .' + traceDimClass).length, 0);
        assert.strictEqual(document.getElementById('trace-status-container')!.style.display, 'none');
    });

    it('still jumps to the definition on a plain click', () => {
        takePostedMessages();
        (document.getElementById('trait_beta')!.querySelector('.navigator') as HTMLElement).click();
        assert.deepStrictEqual(takePostedMessages(), [{ command: 'navigate', start: 1, end: 2, file: undefined }]);
    });

    // The condition filter lists trigger text straight from the mod. It has to come out as the
    // text it went in as, not as markup the page then runs.
    it('lists a condition as text, however it is written', () => {
        const select = document.getElementById('conditions');
        assert.ok(select, 'expected the condition select');
        const options = select!.querySelectorAll('.option');
        assert.strictEqual(options.length, 1);
        assert.strictEqual(options[0].getAttribute('value'), `ROOT!|${hostileCondition}`);
        assert.strictEqual(options[0].textContent, `[ROOT]${hostileCondition}`);
        assert.strictEqual(select!.querySelector('img'), null);
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

    // Two toggles in quick succession start two builds before either finishes; only the newer one
    // may write, or the older markup can land last and stay on screen.
    it('discards a build a newer one superseded', async () => {
        const element = placeholder();
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(element)), 'innerHTML')
            ?? Object.getOwnPropertyDescriptor((window as any).Element.prototype, 'innerHTML')!;
        let writes = 0;
        Object.defineProperty(element, 'innerHTML', {
            configurable: true,
            get() { return descriptor.get!.call(this); },
            set(value: string) { writes++; descriptor.set!.call(this, value); },
        });
        try {
            const input = checkbox('show-grid');
            input.checked = true;
            input.dispatchEvent(new (window as any).Event('change'));
            input.checked = false;
            input.dispatchEvent(new (window as any).Event('change'));
            await settled();
        } finally {
            delete (element as any).innerHTML;
        }
        takePostedMessages();

        assert.strictEqual(writes, 1);
        assert.strictEqual(placeholder().querySelector('.st-mio-grid-line'), null);
        assert.strictEqual(placeholder().querySelectorAll('.trait').length, 3);
    });
});
