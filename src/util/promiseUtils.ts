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
	followOn(startNew: () => Promise<unknown>): Promise<unknown>;
	reset(): void;
}

// Lets a handler defer a mutation until a pending build settles, so it doesn't race the build's writes.
export function createBuildGate(): BuildGate {
	let task: Promise<unknown> | undefined;
	let settled = false;

	function start(newTask: Promise<unknown>): void {
		task = newTask;
		settled = false;
		newTask.then(
			() => {
				if (task === newTask) {
					settled = true;
				}
			},
			() => {
				if (task === newTask) {
					settled = true;
				}
			},
		);
	}

	function runAfterBuild(fn: () => void): void {
		if (!task) {
			return;
		}
		if (settled) {
			fn();
			return;
		}
		const pending = task;
		pending.then(
			() => {
				if (task !== pending) {
					runAfterBuild(fn);
					return;
				}
				fn();
			},
			() => {
				if (task !== pending) {
					runAfterBuild(fn);
					return;
				}
				fn();
			},
		);
	}

	return {
		start,
		runAfterBuild,
		// Occupy the gate now so waiters attach to the follow-on; don't run it until the current build finishes.
		followOn(startNew) {
			const previous = task;
			const next =
				previous !== undefined && !settled
					? previous.then(startNew, startNew)
					: startNew();
			start(next);
			return next;
		},
		reset() {
			task = undefined;
			settled = false;
		},
	};
}
