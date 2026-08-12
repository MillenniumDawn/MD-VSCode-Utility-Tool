import { forceError } from "./common";

export type ErrorReporter = (message: string) => void;

function formatLogMessage(context: string, cause: unknown): string {
	return `${context}: ${forceError(cause).toString()}`;
}

export function attachTaskWithErrorLogging(
	task: Promise<unknown>,
	onSuccess: () => void,
	context: string,
	reportError: ErrorReporter,
): void {
	void task.then(onSuccess).catch((cause) => {
		reportError(formatLogMessage(context, cause));
	});
}

export async function appendEntriesWithErrorLogging(
	target: string[],
	listEntries: () => Promise<string[]>,
	context: string,
	reportError: ErrorReporter,
): Promise<void> {
	try {
		target.push(...(await listEntries()));
	} catch (cause) {
		reportError(formatLogMessage(context, cause));
	}
}
