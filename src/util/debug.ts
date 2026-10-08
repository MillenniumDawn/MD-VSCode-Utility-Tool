import { forceError } from "./common";
import { Logger } from "./logger";

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
    Logger.error(typeof error === 'string' ? error : (realError.stack ?? realError.message));
}
