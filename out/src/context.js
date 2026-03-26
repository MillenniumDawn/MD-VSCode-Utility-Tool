"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVscodeContext = exports.contextContainer = exports.registerContextContainer = void 0;
const vscode = require("vscode");
function registerContextContainer(context) {
    exports.contextContainer.current = context;
    return new vscode.Disposable(() => exports.contextContainer.current = null);
}
exports.registerContextContainer = registerContextContainer;
exports.contextContainer = {
    current: null,
    contextValue: {},
};
function setVscodeContext(key, value) {
    exports.contextContainer.contextValue[key] = value;
    vscode.commands.executeCommand('setContext', key, value);
}
exports.setVscodeContext = setVscodeContext;
//# sourceMappingURL=context.js.map