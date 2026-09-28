import { takePostedMessages, loadEntrypoint, useEntrypoint, resetWebviewState } from './setup';
import * as assert from 'assert';
import { Focus, FocusTree } from '../../previewdef/focustree/schema';

function focus(id: string): Focus {
    return {
        id, icon: [], textIcon: undefined, overlay: undefined,
        x: 0, y: 0, relativePositionId: undefined,
        prerequisite: [], exclusive: [],
        hasAllowBranch: false, inAllowBranch: [], allowBranch: undefined,
        offset: [], token: undefined, file: 'common/national_focus/test.txt', text: undefined,
    };
}

function updateBody(focusId: string, inlay?: { useConditionInFocus: boolean }) {
    const tree: FocusTree = {
        id: 'test_tree',
        focuses: { [focusId]: focus(focusId) },
        inlayWindowRefs: [],
        inlayWindows: inlay ? [{
            id: 'flag_inlay', file: 'common/focus_inlay_windows/test.txt', token: undefined,
            internal: true, position: { x: 1800, y: 50 },
            visible: { scopeName: '', nodeContent: 'has_country_flag = inlay_flag' },
            scriptedImages: [], scriptedButtons: [], conditionExprs: [],
        }] : [],
        inlayConditionExprs: [],
        allowBranchOptions: [], conditionExprs: [],
        isSharedFocues: false, warnings: [],
    };
    return {
        type: 'updateBody',
        data: {
            focusTrees: [tree],
            renderedFocus: { [focusId]: `<div id="focus_${focusId}" class="focus"></div>` },
            renderedInlayWindows: inlay ? { flag_inlay: '<div id="flag_inlay_root"></div>' } : {},
            gridBox: {
                position: { x: { _value: 50 }, y: { _value: 50 } },
                format: { _name: 'up' },
                size: { width: { _value: 96 } },
                slotsize: { width: { _value: 96 }, height: { _value: 130 } },
            },
            useConditionInFocus: inlay?.useConditionInFocus ?? false,
            xGridSize: 96,
        },
    };
}

// The other focustree specs load the entry with its listeners held back, and a cached require
// records nothing, so this file drops the cache entry to get an instance whose `message` handler
// it can drive. It loads with one tree on the page, as the host renders it: the selected tree index
// is taken from that list at load.
resetWebviewState();
(global as any).window.focusTrees = [updateBody('first_focus').data.focusTrees[0]];
delete require.cache[require.resolve('../../../webviewsrc/focustree')];

const { listeners } = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
);
(global as any).window.focusTrees = [];

describe('webview/focustree rendering', () => {
    useEntrypoint(listeners);

    const settled = () => new Promise(resolve => setTimeout(resolve, 0));

    // The grid render awaits more than one tick, so wait for the build to land rather than a
    // fixed number of turns.
    async function rendered(element: HTMLElement): Promise<void> {
        for (let i = 0; i < 100 && element.childElementCount === 0; i++) {
            await settled();
        }
        await settled();
    }

    let previousBody: Node[] = [];

    before(() => {
        previousBody = [...document.body.childNodes];
        const continuous = document.createElement('div');
        continuous.id = 'continuousFocuses';
        const content = document.createElement('div');
        content.id = 'focustreecontent';
        const placeholder = document.createElement('div');
        placeholder.id = 'focustreeplaceholder';
        content.append(placeholder);
        const inlay = document.createElement('div');
        inlay.id = 'inlaywindowplaceholder';
        const warnings = document.createElement('div');
        warnings.id = 'warnings';
        document.body.replaceChildren(continuous, content, inlay, warnings);
    });

    after(() => {
        document.body.replaceChildren(...previousBody);
    });

    // Two updates in quick succession start two builds before either finishes; only the newer one
    // may write, or the older tree can land last and stay on screen.
    it('discards a build a newer one superseded', async () => {
        const element = document.getElementById('focustreeplaceholder')!;
        const descriptor = Object.getOwnPropertyDescriptor((window as any).Element.prototype, 'innerHTML')!;
        let writes = 0;
        Object.defineProperty(element, 'innerHTML', {
            configurable: true,
            get() { return descriptor.get!.call(this); },
            set(value: string) { writes++; descriptor.set!.call(this, value); },
        });
        try {
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: updateBody('first_focus') }));
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: updateBody('second_focus') }));
            await rendered(element);
        } finally {
            delete (element as any).innerHTML;
        }
        takePostedMessages();

        assert.strictEqual(writes, 1);
        assert.ok(element.querySelector('#focus_second_focus'), 'expected the newer tree on screen');
        assert.strictEqual(element.querySelector('#focus_first_focus'), null);
    });

    // An inlay's `visible` trigger can only be met from the inlay conditions dropdown, which exists
    // only in condition mode. Outside it, ticking the window on is what shows it.
    describe('inlay window visible trigger', () => {
        afterEach(() => {
            delete (window as any).__showInlayWindows;
        });

        async function renderInlay(useConditionInFocus: boolean): Promise<HTMLElement> {
            (window as any).__showInlayWindows = true;
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: updateBody('inlay_focus', { useConditionInFocus }) }));
            await rendered(document.getElementById('focustreeplaceholder')!);
            takePostedMessages();
            return document.getElementById('inlaywindowplaceholder')!;
        }

        it('shows a ticked inlay outside condition mode even when its visible trigger is unmet', async () => {
            const placeholder = await renderInlay(false);
            assert.ok(placeholder.querySelector('#flag_inlay_root'), 'expected the inlay on screen');
        });

        it('hides the inlay in condition mode until its visible trigger is selected', async () => {
            const placeholder = await renderInlay(true);
            assert.strictEqual(placeholder.querySelector('#flag_inlay_root'), null);
        });
    });

    // The button is wired by the page's load handler, so the click is only real on a loaded page.
    // The tree it reads is the one on screen now, not the one the page was loaded with.
    it('posts the tree on screen and its warnings when the copy button is clicked', async () => {
        const searchbox = document.createElement('input');
        searchbox.id = 'searchbox';
        const copyButton = document.createElement('button');
        copyButton.id = 'copy-warnings';
        document.body.append(searchbox, copyButton);
        // The load restores the scroll position, which jsdom only reports as not implemented.
        const originalScroll = window.scroll;
        const originalScrollTo = window.scrollTo;
        (window as any).scroll = () => undefined;
        (window as any).scrollTo = () => undefined;
        try {
            window.dispatchEvent(new (window as any).Event('load'));
            for (let i = 0; i < 100 && !takePostedMessages().some(m => m.command === 'ready'); i++) {
                await settled();
            }

            const warned = updateBody('warned_focus');
            warned.data.focusTrees[0].warnings = [{ text: 'Focuses overlap.', source: 'warned_focus' }];
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: warned }));
            const element = document.getElementById('focustreeplaceholder')!;
            for (let i = 0; i < 100 && !element.querySelector('#focus_warned_focus'); i++) {
                await settled();
            }
            takePostedMessages();

            copyButton.click();

            assert.deepStrictEqual(takePostedMessages(), [{
                command: 'copyWarnings',
                treeId: 'test_tree',
                warnings: [{ source: 'warned_focus', text: 'Focuses overlap.' }],
            }]);
        } finally {
            (window as any).scroll = originalScroll;
            (window as any).scrollTo = originalScrollTo;
            searchbox.remove();
            copyButton.remove();
        }
    });
});
