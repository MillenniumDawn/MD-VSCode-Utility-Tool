"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsdom_1 = require("jsdom");
const dom = new jsdom_1.JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
    pretendToBeVisual: true,
});
// global window (no ts-expect-error)
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
    // end of acquireVsCodeApi mock (no ts-expect-error)
});
// Provide browser globals that jsdom exposes on its window so that
// `new Event(...)`, `new MouseEvent(...)`, `new KeyboardEvent(...)` etc.
// work in test code the same way they do in a real browser.
for (const name of [
    'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent',
    'PointerEvent', 'WheelEvent',
]) {
    global[name] = dom.window[name];
}
// Mock i18n table for feLocalize tests
dom.window.__i18ntable = {
    'test.key': 'Translated value',
    'combobox.noselection': '(No selection)',
    'combobox.all': '(All)',
    'combobox.multiple': '{0} (+{1})',
};
//# sourceMappingURL=setup.js.map