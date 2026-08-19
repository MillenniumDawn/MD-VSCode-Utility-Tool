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

export interface BuildGate {
	start(task: Promise<unknown>): void;
	runAfterBuild(fn: () => void): void;
	reset(): void;
}

// Lets a handler defer a mutation until a pending build settles, so it doesn't race the build's writes.
export function createBuildGate(): BuildGate {
	let task: Promise<unknown> | undefined;
	let settled = false;

	return {
		start(newTask) {
			task = newTask;
			settled = false;
			newTask.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
		},
		runAfterBuild(fn) {
			if (!task) {
				return;
			}
			if (settled) {
				fn();
				return;
			}
			task.then(fn, fn);
		},
		reset() {
			task = undefined;
			settled = false;
		},
	};
}
