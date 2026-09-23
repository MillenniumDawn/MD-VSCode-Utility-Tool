import * as vscode from "vscode";
import { localize } from "./i18n";

/** What a long-running job reports into, and watches for a cancel, while it runs. */
export interface ProgressReport {
	/** Files done out of files known, for the message under the title. */
	report(done: number, total: number): void;
	/** Cancelled when the user presses Cancel on this job's notification. */
	readonly token: vscode.CancellationToken;
}

/** A token for a job nothing can cancel, and for the window before the real one arrives. */
export const uncancelledToken: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: () => undefined }),
};

/** What a caller that wants no progress bar passes, so the work itself needs no branch. */
export const noProgress: ProgressReport = {
	token: uncancelledToken,
	report: () => undefined,
};

/**
 * Every report crosses to the renderer, so reporting per parsed file would put thousands of
 * messages on the channel -- and no one can read a counter that changes that fast anyway.
 */
const progressRenderInterval = 100;

/**
 * Runs `work` under its own cancellable notification titled `title`.
 *
 * Deliberately not `withIndexProgress`: that one titles itself "Indexing the workspace" and shares
 * one cancellation token between every build under it, which is right for background builds that
 * should stop together but wrong here. A scan the user just asked for needs its own name, and
 * pressing Cancel on it must not also cancel an index build that happened to be running.
 */
export async function withCancellableProgress<T>(
	title: string,
	work: (progress: ProgressReport) => Promise<T>,
): Promise<T> {
	type Handle = {
		report: vscode.Progress<{ message?: string }>;
		token: vscode.CancellationToken;
	};

	let markReady: (handle: Handle) => void = () => undefined;
	const ready = new Promise<Handle>((resolve) => {
		markReady = resolve;
	});

	// The notification stays up until this resolves, which is what the finally below does.
	let markFinished: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => {
		markFinished = resolve;
	});

	void vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title,
			cancellable: true,
		},
		(report, token) => {
			markReady({ report, token });
			return finished;
		},
	);

	const handle = await ready;
	let lastRenderAt = 0;

	try {
		return await work({
			token: handle.token,
			report: (done, total) => {
				const now = Date.now();
				if (now - lastRenderAt < progressRenderInterval) {
					return;
				}
				lastRenderAt = now;
				handle.report.report({
					message: localize("progress.files", "{0} / {1} files", done, total),
				});
			},
		});
	} finally {
		markFinished();
	}
}
