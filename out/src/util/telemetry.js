"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendException = exports.sendError = exports.sendEvent = void 0;
exports.registerTelemetryReporter = registerTelemetryReporter;
exports.sendByMessage = sendByMessage;
const tslib_1 = require("tslib");
const extension_telemetry_1 = tslib_1.__importDefault(require("@vscode/extension-telemetry"));
let telemetryReporter = undefined;
function registerTelemetryReporter() {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
        telemetryReporter = new extension_telemetry_1.default(EXTENSION_ID, VERSION, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    }
    else {
        telemetryReporter = new DevTelemetryReporter();
    }
    return {
        dispose: () => {
            telemetryReporter?.dispose();
            telemetryReporter = undefined;
        }
    };
}
const sendEvent = (eventName, properties, mesurements) => {
    telemetryReporter?.sendTelemetryEvent(eventName, properties, mesurements);
};
exports.sendEvent = sendEvent;
const sendError = (eventName, properties, mesurements) => {
    telemetryReporter?.sendTelemetryErrorEvent(eventName, properties, mesurements);
};
exports.sendError = sendError;
const sendException = (error, properties, mesurements) => {
    telemetryReporter?.sendTelemetryException(error, properties, mesurements);
};
exports.sendException = sendException;
function sendByMessage(message) {
    switch (message.telemetryType) {
        case 'event':
            (0, exports.sendEvent)(...message.args);
            break;
        case 'error':
            (0, exports.sendError)(...message.args);
            break;
        case 'exception':
            const args = [...message.args];
            const error = new Error();
            error.message = args[0].message;
            error.name = args[0].name;
            error.stack = args[0].stack;
            args[0] = error;
            (0, exports.sendException)(...args);
            break;
    }
}
class DevTelemetryReporter {
    sendTelemetryEvent(eventName, properties, measurements) {
        console.log('TelemetryEvent', eventName, JSON.stringify(properties), JSON.stringify(measurements));
    }
    sendTelemetryErrorEvent(eventName, properties, measurements, errorProps) {
        console.error('TelemetryErrorEvent', eventName, JSON.stringify(properties), JSON.stringify(measurements), JSON.stringify(errorProps));
    }
    sendTelemetryException(error, properties, measurements) {
        console.error('TelemetryException', error, JSON.stringify(properties), JSON.stringify(measurements));
    }
    async dispose() {
    }
}
//# sourceMappingURL=telemetry.js.map