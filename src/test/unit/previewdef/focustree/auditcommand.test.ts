import type * as vscode from "vscode";
import * as assert from "assert";
import * as files from "../../../../util/fileloader";
import * as schema from "../../../../previewdef/focustree/schema";
import { auditFocusTrees } from "../../../../previewdef/focustree/warningreport";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { handOver } from "../../host";

describe("focus audit cancellation at command boundaries", () => {
	const originalList = files.listFilesFromModOrHOI4;
	const originalRead = files.readFileFromModOrHOI4;
	const originalBuild = schema.getFocusTreeWithFocusFile;
	let token: { isCancellationRequested: boolean; onCancellationRequested: () => { dispose(): void } };
	let reads: number, opened: number, shown: number;
	let errors: string[];
	beforeEach(() => {
		reads = opened = shown = 0;
		errors = [];
		token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
		handOver({
			ProgressLocation: { Notification: 15 },
			workspace: {
				getConfiguration: () => ({ useConditionInFocus: true, get: <T>() => undefined as T }),
				openTextDocument: async () => { opened++; return {} as never; },
			},
			window: {
				withProgress: async <T>(_options: vscode.ProgressOptions, callback: (progress: vscode.Progress<{ message?: string }>, token: vscode.CancellationToken) => Thenable<T>) => callback({ report() {} }, token),
				showTextDocument: async () => { shown++; return {} as never; },
				showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
			},
		});
		refreshFeatureFlags();
		Object.assign(files, {
			listFilesFromModOrHOI4: async () => ["a.txt"],
			readFileFromModOrHOI4: async () => {
				reads++;
				return [Buffer.from("focus_tree = { id = a focus = { id = x } }"), undefined];
			},
		});
	});
	afterEach(() => {
		Object.assign(files, { listFilesFromModOrHOI4: originalList, readFileFromModOrHOI4: originalRead });
		Object.assign(schema, { getFocusTreeWithFocusFile: originalBuild });
	});
	function nothingPublished(): void {
		assert.strictEqual(opened, 0);
		assert.strictEqual(shown, 0);
		assert.deepStrictEqual(errors, []);
	}
	it("does not read files after cancellation during listing", async () => {
		Object.assign(files, { listFilesFromModOrHOI4: async () => { token.isCancellationRequested = true; return ["a.txt"]; } });
		await auditFocusTrees();
		assert.strictEqual(reads, 0);
		nothingPublished();
	});
	it("does not parse or publish a read that completed after cancellation", async () => {
		Object.assign(files, { readFileFromModOrHOI4: async () => {
			token.isCancellationRequested = true;
			return [{ toString() { throw new Error("must not parse"); } }, undefined];
		} });
		await auditFocusTrees();
		nothingPublished();
	});
	it("does not publish after cancellation during tree collection", async () => {
		Object.assign(schema, { getFocusTreeWithFocusFile: (...args: Parameters<typeof originalBuild>) => {
			setImmediate(() => { token.isCancellationRequested = true; });
			return originalBuild(...args);
		} });
		await auditFocusTrees();
		nothingPublished();
	});
	it("does not show an editor when cancellation arrives while opening the document", async () => {
		handOver({
			ProgressLocation: { Notification: 15 },
			workspace: {
				getConfiguration: () => ({ useConditionInFocus: true, get: <T>() => undefined as T }),
				openTextDocument: async () => { token.isCancellationRequested = true; return {} as never; },
			},
			window: {
				withProgress: async <T>(_options: vscode.ProgressOptions, callback: (progress: vscode.Progress<{ message?: string }>, token: vscode.CancellationToken) => Thenable<T>) => callback({ report() {} }, token),
				showTextDocument: async () => { shown++; return {} as never; },
				showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
			},
		});
		await auditFocusTrees();
		assert.strictEqual(shown, 0);
		assert.deepStrictEqual(errors, []);
	});
});
