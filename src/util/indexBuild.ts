import * as vscode from "vscode";
import { Commands } from "../constants";
import { createWorkQueue, TimeoutError, withTimeout } from "./common";
import { describeLiveIndexBuilds } from "./indexCache";
import { localize } from "./i18n";
import { Logger } from "./logger";
import { BuildGate, createBuildGate } from "./promiseUtils";

/**
 * The one pool every index parse runs in. Deliberately small: the work is synchronous parsing on
 * the extension host's only thread, so more workers buy no throughput and only lengthen the gap
 * between the host servicing two of its own messages.
 */
export const indexParseQueue = createWorkQueue(4);

/**
 * How long one index build may run before `ensureBuilt` stops waiting on it. This does not stop the
 * build -- only Cancel on the progress notification does that -- it stops callers from waiting
 * forever on one, and it puts a line in the log naming the index that overran. Generous on purpose:
 * a cold build over a mod the size of Millennium Dawn is expected to take a while, a build still
 * running after this long is not going to finish.
 */
export const indexBuildTimeout = 5 * 60 * 1000;

/** What a build reports into, and watches for a cancel, while it runs. */
export interface IndexProgress {
	/** This build's files done out of files known. Aggregated with every other live build's. */
	report(done: number, total: number): void;
	/**
	 * Cancelled when the user presses Cancel. Shared by every build under the same notification,
	 * because "stop indexing" is one decision rather than one per index.
	 */
	readonly token: vscode.CancellationToken;
}

interface ProgressMember {
	label: string;
	done: number;
	total: number;
}

interface ProgressSession {
	readonly members: Set<ProgressMember>;
	report: vscode.Progress<{ message?: string }> | undefined;
	token: vscode.CancellationToken;
	/** Resolves the promise `withProgress` is waiting on, which is what dismisses the notification. */
	close(): void;
	closed: boolean;
	lastRenderAt: number;
}

/**
 * Every report crosses to the renderer, so reporting per parsed file would put thousands of
 * messages on the very channel this whole change exists to keep clear -- and no one can read a
 * counter that changes that fast anyway. Joining and leaving still render immediately, so the
 * first and last state of a build are never the ones dropped.
 */
const progressRenderInterval = 100;

/** A token for the window between asking for a session and `withProgress` handing us the real one. */
const uncancelledToken: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => undefined }),
};

let sessionPromise: Promise<ProgressSession> | undefined;

function renderSession(session: ProgressSession, force: boolean): void {
	const now = Date.now();
	if (!force && now - session.lastRenderAt < progressRenderInterval) {
		return;
	}
	session.lastRenderAt = now;

	let done = 0;
	let total = 0;
	for (const member of session.members) {
		done += member.done;
		total += member.total;
	}

	// Nothing to say yet while the builds are still listing files: the notification shows its title
	// over an indeterminate bar, which is the honest answer to "how far along is it".
	let message: string | undefined;
	if (total > 0) {
		const [first] = [...session.members];
		message =
			session.members.size === 1 && first !== undefined
				? localize(
						"index.progress.one",
						"{0} — {1} / {2} files",
						first.label,
						done,
						total,
					)
				: localize(
						"index.progress.many",
						"{0} indexes — {1} / {2} files",
						session.members.size,
						done,
						total,
					);
	}

	session.report?.report({ message });
}

function openSession(): Promise<ProgressSession> {
	let markReady: (session: ProgressSession) => void = () => undefined;
	const ready = new Promise<ProgressSession>((resolve) => {
		markReady = resolve;
	});

	let markFinished: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => {
		markFinished = resolve;
	});

	const session: ProgressSession = {
		members: new Set(),
		report: undefined,
		token: uncancelledToken,
		close: () => {
			session.closed = true;
			markFinished();
		},
		closed: false,
		lastRenderAt: 0,
	};

	void vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: localize("index.progress.title", "Indexing the workspace"),
			cancellable: true,
		},
		(report, token) => {
			session.report = report;
			session.token = token;
			markReady(session);
			return finished;
		},
	);

	return ready;
}

/**
 * Runs `work` under one shared "Indexing the workspace" notification: the first build to call this
 * opens it, and it closes when the last one finishes.
 *
 * One notification rather than one per build, because `setStatusBarMessage` stacked -- six builds
 * start together on the first preview of a session, and a finished one would re-show an older
 * pending message. It also froze mid-spin during a synchronous parse, which is exactly what made a
 * slow build read as a dead one; a real progress report cannot, because it only moves when work
 * actually finishes.
 */
export async function withIndexProgress<T>(
	label: string,
	work: (progress: IndexProgress) => Promise<T>,
): Promise<T> {
	let session = await (sessionPromise ??= openSession());
	if (session.closed) {
		// Its last member left while we were awaiting it, taking the notification with it. The memo
		// was cleared at the same time, so asking again opens a fresh one -- which cannot already be
		// closed, since only a member can close a session and this one has none yet.
		session = await (sessionPromise ??= openSession());
	}

	const member: ProgressMember = { label, done: 0, total: 0 };
	session.members.add(member);
	renderSession(session, true);

	try {
		return await work({
			token: session.token,
			report: (done, total) => {
				member.done = done;
				member.total = total;
				renderSession(session, false);
			},
		});
	} finally {
		session.members.delete(member);
		if (session.members.size === 0) {
			// Safe to clear unconditionally: the memo is only ever replaced by a session whose
			// predecessor had already emptied, so it cannot be pointing at anyone else's yet.
			sessionPromise = undefined;
			session.close();
		} else {
			renderSession(session, true);
		}
	}
}

/** Test-only: drops a session a build that never settles would otherwise hold open for good. */
export function __resetIndexProgressForTests(): void {
	sessionPromise = undefined;
}

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
	/** Names this build in the shared progress notification for as long as it runs. */
	message: string;
	build: (progress: IndexProgress) => Promise<T>;
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
		// The notification tracks the real work, not the deadline: a build that overran is still
		// running, and hiding its progress at that point would be the same lie the status bar told.
		const underlying = withIndexProgress(message, build);

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
