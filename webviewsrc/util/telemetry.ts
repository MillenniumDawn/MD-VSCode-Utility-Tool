import { vscode } from "./vscode";
import { TelemetryMessage, TelemetryReporterInterface } from "../../src/util/telemetry";

export const sendEvent: TelemetryReporterInterface['sendTelemetryEvent'] = (...args) => {
    const telemetryMessage: TelemetryMessage = {
        command: 'telemetry',
        telemetryType: 'event',
        args,
    };
    vscode.postMessage(telemetryMessage);
};

export const sendError: TelemetryReporterInterface['sendTelemetryErrorEvent'] = (...args) => {
    const telemetryMessage: TelemetryMessage = {
        command: 'telemetry',
        telemetryType: 'error',
        args,
    };
    vscode.postMessage(telemetryMessage);
};

export const sendException: TelemetryReporterInterface['sendTelemetryException'] = (error, ...args) => {
    const telemetryMessage: TelemetryMessage = {
        command: 'telemetry',
        telemetryType: 'exception',
        args: [ serializeError(error), ...args ],
    };
    vscode.postMessage(telemetryMessage);
};

function serializeError(error: Error): Error {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
}
