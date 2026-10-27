import { takePostedMessages, loadEntrypoint, useEntrypoint, resetWebviewState } from './setup';
import * as assert from 'assert';
import { Focus, FocusTree } from '../../previewdef/focustree/schema';
import { iconButtonHtml } from '../../previewdef/toolbaricons';
import { feLocalize } from '../../../webviewsrc/util/i18n';
import { getState, setState } from '../../../webviewsrc/util/common';

function focus(id: string): Focus {
    return {
        id, icon: [], textIcon: undefined, overlay: undefined,
        x: 0, y: 0, relativePositionId: undefined,
        prerequisite: [], exclusive: [],
        hasAllowBranch: false, inAllowBranch: [], allowBranch: undefined,
        offset: [], token: undefined, file: 'common/national_focus/test.txt', text: undefined,
    };
}

// `slot` is a scripted image of the inlay, with the template the host rendered for the window.
function updateBody(focusId: string, inlay?: { useConditionInFocus: boolean; slot?: { id: string; template: string } }) {
    const tree: FocusTree = {
        id: 'test_tree',
        focuses: { [focusId]: focus(focusId) },
        inlayWindowRefs: [],
        inlayWindows: inlay ? [{
            id: 'flag_inlay', file: 'common/focus_inlay_windows/test.txt', token: undefined,
            internal: true, position: { x: 1800, y: 50 },
            visible: { scopeName: '', nodeContent: 'has_country_flag = inlay_flag' },
            scriptedImages: inlay.slot ? [{
                id: inlay.slot.id, file: 'common/focus_inlay_windows/test.txt', token: undefined,
                gfxOptions: [{ gfxName: 'GFX_slot', gfxFile: 'interface/slots.gfx', condition: true, file: 'common/focus_inlay_windows/test.txt', token: undefined }],
            }] : [],
            scriptedButtons: [], conditionExprs: [],
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
            renderedInlayWindows: inlay ? { flag_inlay: inlay.slot?.template ?? '<div id="flag_inlay_root"></div>' } : {},
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

    it('counts visible focus matches, navigates them, and reapplies the query after a rebuild', async () => {
        resetWebviewState();
        setState({ searchboxValue: ' NAVY ' });
        const searchbox = document.createElement('input');
        searchbox.id = 'focus-searchbox';
        const count = document.createElement('span');
        count.id = 'focus-search-count';
        const allowBranch = document.createElement('div');
        allowBranch.id = 'allowbranch';
        allowBranch.className = 'select multiple-select';
        allowBranch.innerHTML = '<span class="value"></span>';
        const allowBranchContainer = document.createElement('div');
        allowBranchContainer.id = 'allowbranch-container';
        allowBranchContainer.append(allowBranch);
        document.body.append(searchbox, count, allowBranchContainer);
        const placeholder = document.getElementById('focustreeplaceholder')!;
        placeholder.innerHTML = '';

        const originalScroll = window.scroll;
        const originalScrollTo = window.scrollTo;
        (window as any).scroll = () => undefined;
        (window as any).scrollTo = () => undefined;
        try {
            const message = updateBody('ENG_navy');
            const first = focus('ENG_navy');
            const branched = focus('FRA_navy');
            branched.inAllowBranch = ['branch_focus'];
            const branch = focus('branch_focus');
            first.x = 0;
            branched.x = 1;
            branch.x = 2;
            message.data.focusTrees[0].focuses = {
                ENG_navy: first,
                FRA_navy: branched,
                branch_focus: branch,
            };
            message.data.focusTrees[0].allowBranchOptions = ['branch_focus'];
            message.data.renderedFocus = {
                ENG_navy: '<div></div>',
                FRA_navy: '<div></div>',
                branch_focus: '<div></div>',
            };
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: message }));
            await rendered(placeholder);

            window.dispatchEvent(new (window as any).Event('load'));
            for (let i = 0; i < 100 && !takePostedMessages().some(m => m.command === 'ready'); i++) {
                await settled();
            }
            await rendered(placeholder);
            takePostedMessages();

            assert.strictEqual(searchbox.value, 'navy');
            assert.strictEqual(count.textContent, '-/2');
            assert.strictEqual(placeholder.querySelectorAll('.focus.ev-hit').length, 2);
            searchbox.value = '';
            searchbox.dispatchEvent(new (window as any).Event('input'));

            const scrolls: string[] = [];
            for (const element of Array.from(placeholder.querySelectorAll<HTMLDivElement>('.focus'))) {
                element.scrollIntoView = () => scrolls.push(element.id);
            }

            searchbox.value = 'navy';
            searchbox.dispatchEvent(new (window as any).Event('input'));
            assert.strictEqual(count.textContent, '1/2');
            assert.strictEqual(placeholder.querySelectorAll('.focus.ev-hit').length, 2);
            assert.deepStrictEqual(scrolls, ['focus_ENG_navy']);

            searchbox.dispatchEvent(new (window as any).KeyboardEvent('keypress', { key: 'Enter' }));
            assert.strictEqual(count.textContent, '2/2');
            searchbox.dispatchEvent(new (window as any).KeyboardEvent('keypress', { key: 'Enter', shiftKey: true }));
            assert.strictEqual(count.textContent, '1/2');
            assert.ok(placeholder.querySelector('#focus_ENG_navy')?.classList.contains('ev-hit-current'));
            assert.deepStrictEqual(scrolls, ['focus_ENG_navy', 'focus_FRA_navy', 'focus_ENG_navy']);

            allowBranch.dispatchEvent(new (window as any).MouseEvent('mousedown', { bubbles: true }));
            const branchOption = document.querySelector('.select-dropdown input[type="checkbox"]') as HTMLInputElement;
            assert.ok(branchOption, 'expected the allow-branch option in the dropdown');
            branchOption.click();
            assert.strictEqual(count.textContent, '1/1');
            assert.strictEqual(placeholder.querySelector<HTMLDivElement>('#focus_FRA_navy')?.style.display, 'none');

            const updated = updateBody('ENG_navy');
            updated.data.focusTrees[0].focuses = { ENG_navy: focus('ENG_navy'), USA_navy: focus('USA_navy') };
            updated.data.focusTrees[0].focuses.USA_navy!.x = 1;
            updated.data.renderedFocus = {
                ENG_navy: '<div></div>',
                USA_navy: '<div></div>',
            };
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: updated }));
            await rendered(placeholder);
            assert.strictEqual(searchbox.value, 'navy');
            assert.strictEqual(count.textContent, '1/2');
            assert.strictEqual(placeholder.querySelectorAll('.focus.ev-hit').length, 2);

            searchbox.value = 'missing';
            searchbox.dispatchEvent(new (window as any).Event('paste'));
            searchbox.dispatchEvent(new (window as any).Event('input'));
            assert.strictEqual(count.textContent, 'no matches');
            assert.strictEqual(placeholder.querySelectorAll('.focus.ev-hit').length, 0);
            searchbox.value = '';
            searchbox.dispatchEvent(new (window as any).Event('cut'));
            searchbox.dispatchEvent(new (window as any).Event('input'));
            assert.strictEqual(count.textContent, '');
        } finally {
            (window as any).scroll = originalScroll;
            (window as any).scrollTo = originalScrollTo;
            searchbox.remove();
            count.remove();
            allowBranchContainer.remove();
        }
    });

    // A shared focus may sit relative_position_id to a joint focus of the same file. The joint
    // focus is not drawn in the <Shared focuses> tree, but it still has to place its dependents.
    it('places a shared focus relative to an anchor from the other pseudo-tree', async () => {
        const anchored = { ...focus('sh_anchored'), x: 0, y: 1, relativePositionId: 'joint_anchor' };
        const plain = { ...focus('sh_plain'), x: 0, y: 1 };
        const message = updateBody('sh_plain');
        const tree = message.data.focusTrees[0];
        tree.focuses = { sh_anchored: anchored, sh_plain: plain };
        tree.isSharedFocues = true;
        tree.anchorFocuses = { joint_anchor: { ...focus('joint_anchor'), x: 4, y: 0 } };
        message.data.renderedFocus = {
            sh_anchored: '<div id="focus_sh_anchored" class="focus"></div>',
            sh_plain: '<div id="focus_sh_plain" class="focus"></div>',
        };
        const element = document.getElementById('focustreeplaceholder')!;
        window.dispatchEvent(new (window as any).MessageEvent('message', { data: message }));
        await rendered(element);
        takePostedMessages();

        const left = (id: string) => parseFloat(element.querySelector<HTMLElement>(`#${id}`)!.style.left);
        assert.strictEqual(left('focus_sh_anchored') - left('focus_sh_plain'), 4 * 96);
        assert.strictEqual(element.querySelector('#focus_joint_anchor'), null);
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

    // The host names the class to swap after the slot, spelled so that no id can close the attribute
    // it sits in. The page has to spell it the same way, or the slot is left without its image.
    it('swaps the class of an inlay slot whose id holds a quote, a bracket and </style>', async () => {
        (window as any).__showInlayWindows = true;
        try {
            const slot = {
                id: 'a"b<c></style>',
                template: '<div id="slot" class="{{inlay_slot_class:a%22b%3Cc%3E%3C%2Fstyle%3E}} st-slot"></div>',
            };
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: updateBody('slot_focus', { useConditionInFocus: false, slot }) }));
            await rendered(document.getElementById('focustreeplaceholder')!);
            takePostedMessages();

            const placeholder = document.getElementById('inlaywindowplaceholder')!;
            assert.deepStrictEqual([...placeholder.querySelector('#slot')!.classList], ['st-inlay-gfx-interface_47slots_46gfx_45GFX_slot', 'st-slot']);
            assert.ok(!placeholder.innerHTML.includes('{{'), placeholder.innerHTML);
        } finally {
            delete (window as any).__showInlayWindows;
        }
    });

    it('keeps the images of distinct inlay slots separate', async () => {
        (window as any).__showInlayWindows = true;
        try {
            const message = updateBody('slot_focus', { useConditionInFocus: false, slot: {
                id: 'a-b',
                template: '<div id="first" class="{{inlay_slot_class:a-b}}"></div><div id="second" class="{{inlay_slot_class:a_45b}}"></div>',
            } });
            const slots = message.data.focusTrees[0].inlayWindows[0]!.scriptedImages;
            slots.push({ ...slots[0]!, id: 'a_45b', gfxOptions: [{ ...slots[0]!.gfxOptions[0]!, gfxName: 'GFX_other' }] });
            window.dispatchEvent(new (window as any).MessageEvent('message', { data: message }));
            await rendered(document.getElementById('focustreeplaceholder')!);
            takePostedMessages();

            const placeholder = document.getElementById('inlaywindowplaceholder')!;
            assert.strictEqual(placeholder.querySelector('#first')!.className, 'st-inlay-gfx-interface_47slots_46gfx_45GFX_slot');
            assert.strictEqual(placeholder.querySelector('#second')!.className, 'st-inlay-gfx-interface_47slots_46gfx_45GFX_other');
            assert.ok(!placeholder.innerHTML.includes('{{'), placeholder.innerHTML);
        } finally {
            delete (window as any).__showInlayWindows;
        }
    });

    // The button is wired by the page's load handler, so the click is only real on a loaded page.
    // The tree it reads is the one on screen now, not the one the page was loaded with.
    it('posts the tree on screen and its warnings when the copy button is clicked', async () => {
        const searchbox = document.createElement('input');
        searchbox.id = 'focus-searchbox';
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

describe('webview/focustree rendering toolbar toggles', () => {
    useEntrypoint(listeners);

    const settled = () => new Promise(resolve => setTimeout(resolve, 0));
    let previousBody = '';
    let previousTrees: unknown;

    before(async () => {
        previousBody = document.body.innerHTML;
        previousTrees = (window as any).focusTrees;
        (window as any).focusTrees = [updateBody('first_focus').data.focusTrees[0]];
        document.body.innerHTML = `
            <div class="toolbar-outer"><div class="toolbar">
                <input id="focus-searchbox" type="text"/>
                ${iconButtonHtml('showWarnings', feLocalize, { domId: 'show-warnings', on: false })}
                ${iconButtonHtml('warningMarkers', feLocalize, { domId: 'toggle-warning-markers', on: true })}
            </div></div>
            <div id="continuousFocuses"></div>
            <div id="focustreecontent"><div id="focustreeplaceholder"></div></div>
            <div id="inlaywindowplaceholder"></div>
            <div id="warnings-container" style="display:none"><div id="warnings"></div></div>`;
        window.dispatchEvent(new (window as any).Event('load'));
        for (let i = 0; i < 20; i++) {
            await settled();
        }
        takePostedMessages();
    });

    after(() => {
        document.body.innerHTML = previousBody;
        (window as any).focusTrees = previousTrees;
    });

    function icon(button: HTMLElement): string | undefined {
        return Array.from(button.querySelector('i')?.classList ?? []).find(c => c.startsWith('codicon-'));
    }

    it('marks the warning list button pressed while the list is open', () => {
        const button = document.getElementById('show-warnings')!;
        const container = document.getElementById('warnings-container')!;
        assert.strictEqual(button.getAttribute('aria-pressed'), 'false');

        button.dispatchEvent(new (window as any).Event('click'));
        assert.strictEqual(container.style.display, 'block');
        assert.strictEqual(button.getAttribute('aria-pressed'), 'true');

        button.dispatchEvent(new (window as any).Event('click'));
        assert.strictEqual(container.style.display, 'none');
        assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
    });

    it('swaps the warning marker icon and pressed state instead of dimming the button', () => {
        const button = document.getElementById('toggle-warning-markers')!;
        assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(icon(button), 'codicon-circle-large-filled');

        button.dispatchEvent(new (window as any).Event('click'));
        assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
        assert.strictEqual(icon(button), 'codicon-circle-large-outline');
        assert.strictEqual(button.style.opacity, '');

        button.dispatchEvent(new (window as any).Event('click'));
        assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(icon(button), 'codicon-circle-large-filled');
    });
});

describe('webview/focustree condition dropdowns', () => {
    useEntrypoint(listeners);

    const settled = () => new Promise(resolve => setTimeout(resolve, 0));
    const war = { scopeName: '', nodeContent: 'has_war = yes' };
    const flag = { scopeName: 'ROOT', nodeContent: 'has_country_flag = inlay_flag' };
    let previousBody = '';

    before(async () => {
        previousBody = document.body.innerHTML;
        resetWebviewState();
        document.body.innerHTML = `
            <div id="condition-container"><div id="conditions" class="select multiple-select"><span class="value"></span></div></div>
            <div id="inlay-condition-container"><div id="inlay-conditions" class="select multiple-select"><span class="value"></span></div></div>
            <div id="continuousFocuses"></div>
            <div id="focustreecontent"><div id="focustreeplaceholder"></div></div>
            <div id="inlaywindowplaceholder"></div>
            <div id="warnings-container" style="display:none"><div id="warnings"></div></div>`;
        // Condition mode comes with the tree, and the load handler only builds the dropdowns in it.
        const message = updateBody('cond_focus', { useConditionInFocus: true });
        message.data.focusTrees[0].conditionExprs = [war];
        message.data.focusTrees[0].inlayConditionExprs = [flag];
        window.dispatchEvent(new (window as any).MessageEvent('message', { data: message }));
        const originalScroll = window.scroll;
        const originalScrollTo = window.scrollTo;
        (window as any).scroll = () => undefined;
        (window as any).scrollTo = () => undefined;
        try {
            window.dispatchEvent(new (window as any).Event('load'));
            for (let i = 0; i < 100 && !takePostedMessages().some(m => m.command === 'ready'); i++) {
                await settled();
            }
            for (let i = 0; i < 20; i++) {
                await settled();
            }
        } finally {
            (window as any).scroll = originalScroll;
            (window as any).scrollTo = originalScrollTo;
        }
        takePostedMessages();
    });

    after(() => {
        document.body.innerHTML = previousBody;
        resetWebviewState();
    });

    async function pickFirst(id: string): Promise<void> {
        const select = document.getElementById(id)!;
        select.dispatchEvent(new (window as any).MouseEvent('mousedown', { cancelable: true }));
        (document.querySelector('ul.select-dropdown li') as HTMLElement).click();
        select.dispatchEvent(new (window as any).MouseEvent('mousedown', { cancelable: true }));
        for (let i = 0; i < 20; i++) {
            await settled();
        }
        takePostedMessages();
    }

    it('keeps the focus and inlay condition picks apart, each under its own key', async () => {
        await pickFirst('conditions');
        assert.deepStrictEqual(getState().selectedExprs, [war]);
        assert.deepStrictEqual(getState().selectedInlayExprs, []);

        await pickFirst('inlay-conditions');
        assert.deepStrictEqual(getState().selectedExprs, [war]);
        assert.deepStrictEqual(getState().selectedInlayExprs, [flag]);
    });
});
