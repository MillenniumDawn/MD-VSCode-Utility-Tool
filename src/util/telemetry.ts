export interface TelemetryReporterInterface {
    sendTelemetryEvent(eventName: string, properties?: {
        [key: string]: string;
    }, measurements?: {
        [key: string]: number;
    }): void;
    sendTelemetryErrorEvent(eventName: string, properties?: {
        [key: string]: string;
    }, measurements?: {
        [key: string]: number;
    }, errorProps?: string[]): void;
    sendTelemetryException(error: Error, properties?: {
        [key: string]: string;
    }, measurements?: {
        [key: string]: number;
    }): void;
    dispose(): Promise<unknown>;
}

let telemetryReporter: TelemetryReporterInterface | undefined = undefined;

export interface TelemetryMessage {
    command: 'telemetry';
    telemetryType: 'event' | 'error' | 'exception';
    args: unknown[];
}

export function registerTelemetryReporter() {
    // Telemetry is disabled: no reporter is constructed, so every send* call is a no-op.
    return {
        dispose: () => {
            void telemetryReporter?.dispose();
            telemetryReporter = undefined;
        }
    };
}

export const sendEvent = (eventName: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) => {
    telemetryReporter?.sendTelemetryEvent(eventName, properties, measurements);
};

export const sendError = (eventName: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }, errorProps?: string[]) => {
    telemetryReporter?.sendTelemetryErrorEvent(eventName, properties, measurements, errorProps);
};

export const sendException = (error: Error, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) => {
    telemetryReporter?.sendTelemetryException(error, properties, measurements);
};

export function sendByMessage(message: TelemetryMessage) {
    switch (message.telemetryType) {
        case 'event':
            sendEvent(...(message.args as Parameters<typeof sendEvent>));
            break;
        case 'error':
            sendError(...(message.args as Parameters<typeof sendError>));
            break;
        case 'exception':
            const [serialized, properties, measurements] = message.args as [
                Partial<Pick<Error, 'message' | 'name' | 'stack'>> | undefined,
                Record<string, string> | undefined,
                Record<string, number> | undefined,
            ];
            const error = new Error(serialized?.message);
            error.name = serialized?.name ?? error.name;
            error.stack = serialized?.stack;
            sendException(error, properties, measurements);
            break;
    }
}
