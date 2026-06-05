import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
    pretendToBeVisual: true,
});

// global window (no ts-expect-error)
(global as any).window = dom.window;
(global as any).document = dom.window.document;

// Mock acquireVsCodeApi for webview tests
const state: Record<string, any> = {};
(global as any).acquireVsCodeApi = () => ({
    postMessage: () => {},
    getState: () => state,
    setState: (s: Record<string, any>) => {
        Object.assign(state, s);
    },
    // end of acquireVsCodeApi mock (no ts-expect-error)
});

// Mock i18n table for feLocalize tests
(dom.window as any).__i18ntable = {
    'test.key': 'Translated value',
    'combobox.noselection': '(No selection)',
    'combobox.all': '(All)',
    'combobox.multiple': '{0} (+{1})',
};
