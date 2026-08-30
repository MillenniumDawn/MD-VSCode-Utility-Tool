import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
    pretendToBeVisual: true,
});

// global window (no ts-expect-error)
(global as any).window = dom.window;
(global as any).document = dom.window.document;

// Everything the webview posted back to the host, newest last. A test that cares what a click did
// -- whether it asked the editor to navigate, say -- reads and clears this instead of stubbing the
// api again after the module under test has already taken its handle.
export const postedMessages: any[] = [];

export function takePostedMessages(): any[] {
    return postedMessages.splice(0, postedMessages.length);
}

// Mock acquireVsCodeApi for webview tests
const state: Record<string, any> = {};
(global as any).acquireVsCodeApi = () => ({
    postMessage: (message: any) => {
        postedMessages.push(message);
    },
    getState: () => state,
    setState: (s: Record<string, any>) => {
        Object.assign(state, s);
    },
    // end of acquireVsCodeApi mock (no ts-expect-error)
});

// Provide browser globals that jsdom exposes on its window so that
// `new Event(...)`, `new MouseEvent(...)`, `new KeyboardEvent(...)` etc.
// work in test code the same way they do in a real browser.
for (const name of [
    'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent',
    'PointerEvent', 'WheelEvent',
]) {
    (global as any)[name] = (dom.window as any)[name];
}

// Mock i18n table for feLocalize tests
(dom.window as any).__i18ntable = {
    'test.key': 'Translated value',
    'combobox.noselection': '(No selection)',
    'combobox.all': '(All)',
    'combobox.multiple': '{0} (+{1})',
};
