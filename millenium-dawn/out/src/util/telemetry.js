"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendByMessage = exports.sendException = exports.sendError = exports.sendEvent = exports.registerTelemetryReporter = void 0;
const tslib_1 = require("tslib");
const extension_telemetry_1 = require("@vscode/extension-telemetry");
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
            telemetryReporter === null || telemetryReporter === void 0 ? void 0 : telemetryReporter.dispose();
            telemetryReporter = undefined;
        }
    };
}
exports.registerTelemetryReporter = registerTelemetryReporter;
const sendEvent = (eventName, properties, mesurements) => {
    telemetryReporter === null || telemetryReporter === void 0 ? void 0 : telemetryReporter.sendTelemetryEvent(eventName, properties, mesurements);
};
exports.sendEvent = sendEvent;
const sendError = (eventName, properties, mesurements) => {
    telemetryReporter === null || telemetryReporter === void 0 ? void 0 : telemetryReporter.sendTelemetryErrorEvent(eventName, properties, mesurements);
};
exports.sendError = sendError;
const sendException = (error, properties, mesurements) => {
    telemetryReporter === null || telemetryReporter === void 0 ? void 0 : telemetryReporter.sendTelemetryException(error, properties, mesurements);
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
exports.sendByMessage = sendByMessage;
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
    dispose() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
        });
    }
}
//# sourceMappingURL=telemetry.js.map