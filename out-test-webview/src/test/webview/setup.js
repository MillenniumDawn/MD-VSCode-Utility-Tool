"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsdom_1 = require("jsdom");
const dom = new jsdom_1.JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
    pretendToBeVisual: true,
});
// @ts-expect-error global window
global.window = dom.window;
global.document = dom.window.document;
// Mock acquireVsCodeApi for webview tests
const state = {};
global.acquireVsCodeApi = () => ({
    postMessage: () => { },
    getState: () => state,
    setState: (s) => {
        Object.assign(state, s);
    },
    // @ts-expect-error
});
// Mock i18n table for feLocalize tests
dom.window.__i18ntable = {
    'test.key': 'Translated value',
    'combobox.noselection': '(No selection)',
    'combobox.all': '(All)',
    'combobox.multiple': '{0} (+{1})',
};
//# sourceMappingURL=setup.js.map