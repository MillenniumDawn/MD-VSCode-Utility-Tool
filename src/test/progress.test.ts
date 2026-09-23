import * as assert from "assert";
import * as vscode from "vscode";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
import { noProgress, withCancellableProgress } from "../util/progress";

// The notification a foreground job runs under. Its own, rather than the shared index one, so
// cancelling a scan cannot also cancel a background index build. Issue #203.
describe("util/progress withCancellableProgress", () => {
	interface Opened {
		title?: string;
		cancellable?: boolean;
		location?: unknown;
		closed: boolean;
		messages: (string | undefined)[];
	}

	let opened: Opened[] = [];

	function stubProgress(cancelled = false): void {
		opened = [];
		stubVscode({
			withProgress: (options: any, task: any) => {
				const entry: Opened = {
					title: options?.title,
					cancellable: options?.cancellable,
					location: options?.location,
					closed: false,
					messages: [],
				};
				opened.push(entry);
				const result = task(
					{ report: (value: any) => entry.messages.push(value?.message) },
					{
						isCancellationRequested: cancelled,
						onCancellationRequested: () => ({ dispose: () => undefined }),
					},
				);
				void Promise.resolve(result).then(() => {
					entry.closed = true;
				});
				return result;
			},
		});
	}

	afterEach(() => {
		restoreVscodeStubs();
	});

	it("opens one cancellable notification under the given title", async () => {
		stubProgress();

		const result = await withCancellableProgress("Scanning references", async () => 42);

		assert.strictEqual(result, 42);
		assert.strictEqual(opened.length, 1);
		assert.strictEqual(opened[0]!.title, "Scanning references");
		assert.strictEqual(opened[0]!.cancellable, true);
		assert.strictEqual(opened[0]!.location, vscode.ProgressLocation.Notification);
	});

	it("closes the notification once the work settles", async () => {
		stubProgress();

		await withCancellableProgress("Scanning references", async () => undefined);
		await Promise.resolve();

		assert.strictEqual(opened[0]!.closed, true);
	});

	it("closes the notification when the work throws, and lets the error through", async () => {
		stubProgress();

		await assert.rejects(
			withCancellableProgress("Scanning references", async () => {
				throw new Error("boom");
			}),
			/boom/,
		);
		await Promise.resolve();

		assert.strictEqual(opened[0]!.closed, true);
	});

	it("hands the work a token that reports the cancel", async () => {
		stubProgress(true);

		let seen: boolean | undefined;
		await withCancellableProgress("Scanning references", async (progress) => {
			seen = progress.token.isCancellationRequested;
		});

		assert.strictEqual(seen, true);
	});

	it("reports the first message rather than throttling it away", async () => {
		stubProgress();

		await withCancellableProgress("Scanning references", async (progress) => {
			progress.report(1, 10);
		});

		assert.deepStrictEqual(opened[0]!.messages, ["1 / 10 files"]);
	});

	it("noProgress swallows reports and never claims a cancel", () => {
		assert.strictEqual(noProgress.token.isCancellationRequested, false);
		assert.doesNotThrow(() => noProgress.report(1, 2));
	});
});
