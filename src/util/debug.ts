import { sendException } from "./telemetry";
import { forceError, UserError } from "./common";

export function debug(message: any, ...args: any[]): void {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...args);
    }
}

export function error(error: unknown): void {
    console.error(error);
    let realError = forceError(error);

    // Duck-type YAMLException by name so this module doesn't statically import js-yaml (which would
    // pull the library in at activation just for logging). js-yaml sets `name` to 'YAMLException'.
    const isYamlException = (error as { name?: string } | null)?.name === 'YAMLException';
    if (!(error instanceof UserError) && !isYamlException) {
        sendException(realError, { callerStack: new Error().stack ?? '' });
    }
}
