"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendException = exports.sendError = exports.sendEvent = void 0;
const vscode_1 = require("./vscode");
const sendEvent = (...args) => {
    const telemetryMessage = {
        command: 'telemetry',
        telemetryType: 'event',
        args,
    };
    vscode_1.vscode.postMessage(telemetryMessage);
};
exports.sendEvent = sendEvent;
const sendError = (...args) => {
    const telemetryMessage = {
        command: 'telemetry',
        telemetryType: 'error',
        args,
    };
    vscode_1.vscode.postMessage(telemetryMessage);
};
exports.sendError = sendError;
const sendException = (error, ...args) => {
    const telemetryMessage = {
        command: 'telemetry',
        telemetryType: 'exception',
        args: [serializeError(error), ...args],
    };
    vscode_1.vscode.postMessage(telemetryMessage);
};
exports.sendException = sendException;
function serializeError(error) {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
}
//# sourceMappingURL=telemetry.js.map