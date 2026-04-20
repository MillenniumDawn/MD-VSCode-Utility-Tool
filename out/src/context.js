"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextContainer = void 0;
exports.registerContextContainer = registerContextContainer;
exports.setVscodeContext = setVscodeContext;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
function registerContextContainer(context) {
    exports.contextContainer.current = context;
    return new vscode.Disposable(() => exports.contextContainer.current = null);
}
exports.contextContainer = {
    current: null,
    contextValue: {},
};
function setVscodeContext(key, value) {
    exports.contextContainer.contextValue[key] = value;
    vscode.commands.executeCommand('setContext', key, value);
}
//# sourceMappingURL=context.js.map