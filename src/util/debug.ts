import { sendException } from "./telemetry";
import { forceError, UserError } from "./common";

// The unit tests set MD_UTILITIES_TEST (in their vscode stub), so a passing run is not buried
// under every debug line the code under test prints.
export function debug(message: unknown, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production' && !process.env.MD_UTILITIES_TEST) {
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
