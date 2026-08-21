import * as vscode from "vscode";
import { Commands } from "../constants";
import { TimeoutError, withTimeout } from "./common";
import { describeLiveIndexBuilds } from "./indexCache";
import { localize } from "./i18n";
import { Logger } from "./logger";
import { BuildGate, createBuildGate } from "./promiseUtils";

/**
 * How long one index build may run before `ensureBuilt` stops waiting on it. The work itself is
 * not cancellable yet, so this does not stop the build -- it stops callers from waiting forever on
 * one, and it puts a line in the log naming the index that overran. Generous on purpose: a cold
 * build over a mod the size of Millennium Dawn is expected to take a while, a build still running
 * after this long is not going to finish.
 */
export const indexBuildTimeout = 5 * 60 * 1000;

export interface IndexBuilder<T> {
	/** Starts the build on the first call; every later call awaits the same one. */
	ensureBuilt(): Promise<T>;
	/**
	 * Whether a build has ever been kicked off. Incremental event handlers use this to stay inert
	 * until something has actually asked for the index.
	 */
	hasStarted(): boolean;
	/** Defers incremental mutations until the in-flight build settles. */
	readonly gate: BuildGate;
	/** Test-only: drops the memoized build so an isolated test can exercise the lazy-build path. */
	reset(): void;
	/**
	 * Test-only: marks the index as already built with `result`, so a test can seed the index maps
	 * directly and still have the incremental event handlers treat it as live.
	 */
	seed(result: T): void;
}

export interface IndexBuilderOptions<T> {
	/** Short name for logs and the index status report, e.g. `"Shared Focus"`. */
	name: string;
	/** Status bar text shown for as long as the build runs. */
	message: string;
	build: () => Promise<T>;
	onSuccess?: () => void;
	/** Overrides {@link indexBuildTimeout}; tests use this to keep the deadline short. */
	timeout?: number;
}

/**
 * The shared shape of all four indexes: build once, lazily, on the first lookup, and let every
 * later lookup await that same build.
 *
 * Two things this gets right that four hand-written copies did not. A build that fails is no
 * longer memoized, so the next lookup retries instead of reading a half-built index for the rest
 * of the session. And no caller waits on a build forever: the promise handed out always settles,
 * whether or not the work behind it does.
 */
export function createIndexBuilder<T>(
	options: IndexBuilderOptions<T>,
): IndexBuilder<T> {
	const { name, message, build, onSuccess } = options;
	const timeout = options.timeout ?? indexBuildTimeout;
	const gate = createBuildGate();
	let buildTask: Promise<T> | undefined;

	function ensureBuilt(): Promise<T> {
		if (buildTask) {
			return buildTask;
		}

		Logger.info(`[Index] ${name}: build started`);
		const underlying = build();

		const task = withTimeout(underlying, timeout, () => {
			Logger.error(
				`[Index] ${name}: build still running after ${timeout}ms, giving up on it. ` +
					`Live index phases: ${describeLiveIndexBuilds().join("; ") || "none"}`,
			);
			return new TimeoutError(`${name} index build timed out after ${timeout}ms`);
		});

		buildTask = task;
		gate.start(task);

		// Retry policy, keyed on the real work rather than on `task`: a build that overran the
		// deadline is still running, and clearing the memo then would start a second one behind it.
		underlying.then(
			() => {
				if (buildTask === task) {
					// It did finish, just too late for whoever timed out. Hand later callers the
					// result instead of the rejection they would otherwise keep getting.
					buildTask = underlying;
				}
			},
			() => {
				if (buildTask === task) {
					buildTask = undefined;
					gate.reset();
				}
			},
		);

		vscode.window.setStatusBarMessage("$(loading~spin) " + message, task);

		void task.then(
			() => {
				Logger.info(`[Index] ${name}: build done`);
				onSuccess?.();
			},
			(cause: unknown) => {
				Logger.error(`[Index] ${name}: build failed: ${cause}`);
			},
		);

		return task;
	}

	return {
		ensureBuilt,
		hasStarted: () => buildTask !== undefined,
		gate,
		reset: () => {
			buildTask = undefined;
			gate.reset();
		},
		seed: (result: T) => {
			const task = Promise.resolve(result);
			buildTask = task;
			gate.start(task);
		},
	};
}

/**
 * Answers "is it stuck, or is it working?" without waiting for a build to finish -- the question
 * every report of the extension hanging on indexing starts with. Writes the live phases to the log
 * and shows the same line, so a report can be pasted straight out of the output channel.
 */
export function registerIndexStatusCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(Commands.ShowIndexStatus, () => {
		const live = describeLiveIndexBuilds();
		const summary =
			live.length === 0
				? localize("indexStatus.idle", "No index build is running.")
				: localize(
						"indexStatus.running",
						"Index builds running: {0}",
						live.join("; "),
					);
		Logger.info(`[Index] status: ${summary}`);
		void vscode.window.showInformationMessage(summary);
	});
}
