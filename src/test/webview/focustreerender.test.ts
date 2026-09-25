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

function updateBody(focusId: string) {
    const tree: FocusTree = {
        id: 'test_tree',
        focuses: { [focusId]: focus(focusId) },
        inlayWindowRefs: [], inlayWindows: [], inlayConditionExprs: [],
        allowBranchOptions: [], conditionExprs: [],
        isSharedFocues: false, warnings: [],
    };
    return {
        type: 'updateBody',
        data: {
            focusTrees: [tree],
            renderedFocus: { [focusId]: `<div id="focus_${focusId}" class="focus"></div>` },
            renderedInlayWindows: {},
            gridBox: {
                position: { x: { _value: 50 }, y: { _value: 50 } },
                format: { _name: 'up' },
                size: { width: { _value: 96 } },
                slotsize: { width: { _value: 96 }, height: { _value: 130 } },
            },
            useConditionInFocus: false,
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

    let previousBody = '';

    before(() => {
        previousBody = document.body.innerHTML;
        document.body.innerHTML = `
            <div id="continuousFocuses"></div>
            <div id="focustreecontent"><div id="focustreeplaceholder"></div></div>
            <div id="inlaywindowplaceholder"></div>
            <div id="warnings"></div>`;
    });

    after(() => {
        document.body.innerHTML = previousBody;
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
});
