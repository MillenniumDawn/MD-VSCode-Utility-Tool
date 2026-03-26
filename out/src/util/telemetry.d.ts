import TelemetryReporter from '@vscode/extension-telemetry';
export interface TelemetryMessage {
    command: 'telemetry';
    telemetryType: 'event' | 'error' | 'exception';
    args: any[];
}
export declare function registerTelemetryReporter(): {
    dispose: () => void;
};
export declare const sendEvent: TelemetryReporter['sendTelemetryEvent'];
export declare const sendError: TelemetryReporter['sendTelemetryErrorEvent'];
export declare const sendException: TelemetryReporter['sendTelemetryException'];
export declare function sendByMessage(message: TelemetryMessage): void;
