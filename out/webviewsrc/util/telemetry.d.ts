import TelemetryReporter from "@vscode/extension-telemetry";
export declare const sendEvent: TelemetryReporter['sendTelemetryEvent'];
export declare const sendError: TelemetryReporter['sendTelemetryErrorEvent'];
export declare const sendException: TelemetryReporter['sendTelemetryException'];
