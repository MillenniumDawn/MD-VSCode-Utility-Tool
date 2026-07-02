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
    dispose(): Promise<any>;
}

let telemetryReporter: TelemetryReporterInterface | undefined = undefined;

export interface TelemetryMessage {
    command: 'telemetry';
    telemetryType: 'event' | 'error' | 'exception';
    args: any[];
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
            const args = [...message.args];
            const error = new Error();
            error.message = args[0].message;
            error.name = args[0].name;
            error.stack = args[0].stack;
            args[0] = error;
            sendException(...(args as Parameters<typeof sendException>));
            break;
    }
}
