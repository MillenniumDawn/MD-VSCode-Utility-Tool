import * as assert from "assert";
import * as vscode from "vscode";
import { registerHoiFs } from "../util/hoifs";
import { registerModFile, modFileStatusContainer } from "../util/modfile";
import { getInstallPathUri, setInstallPathUri } from "../util/installpath";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// Picking a mod file or an install path writes a setting, and that write can reject -- with no
// workspace open, the workspace-scoped one always does. Both used to carry on regardless, so the
// status bar named a mod that had never been stored and the in-memory install path pointed at a
// folder the settings did not name. Issue #203.
describe("settings writes that fail", () => {
	let handlers: Record<string, (...args: any[]) => any>;
	let errors: string[];
	let registration: vscode.Disposable | undefined;

	function stubRejectingWrite(options: {
		picked: unknown;
		modFile?: string;
	}): void {
		handlers = {};
		errors = [];
		stubVscode({
			registerCommand: (command, handler) => {
				handlers[command] = handler;
				return { dispose: () => undefined };
			},
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined;
			},
			showOpenDialog: async () => [options.picked],
			// The mod picker's last entry is "Browse a .mod file...", which sends it to the open
			// dialog above; taking it is the shortest route to the write.
			showQuickPick: async (items: any) => items[items.length - 1],
			getConfiguration: () => ({
				get: () => undefined,
				modFile: options.modFile ?? "",
				update: () => Promise.reject(new Error("no workspace")),
				inspect: () => undefined,
			}),
		});
	}

	afterEach(() => {
		registration?.dispose();
		registration = undefined;
		restoreVscodeStubs();
	});

	it("leaves the install path alone when the setting cannot be saved", async () => {
		// getInstallPathUri throws when nothing is set, so start from a known one.
		const before = vscode.Uri.file("/games/hoi4-original");
		setInstallPathUri(before);
		stubRejectingWrite({ picked: vscode.Uri.file("/games/hoi4-picked") });

		registration = registerHoiFs();
		await handlers["mdhoi4utilities.selecthoifolder"]!();

		assert.strictEqual(
			getInstallPathUri().fsPath,
			before.fsPath,
			"the install path moved even though the write rejected",
		);
		// Matched rather than counted: setting the baseline above also makes checkInstallPath
		// complain that the fake folder does not exist, which is this test's own noise.
		assert.ok(
			errors.some((message) => message.includes("no workspace")),
			`the failure was not reported: ${JSON.stringify(errors)}`,
		);
	});

	it("leaves the mod file status bar alone when the setting cannot be saved", async () => {
		stubRejectingWrite({ picked: vscode.Uri.file("/ws/descriptor.mod") });

		registration = registerModFile();
		const before = modFileStatusContainer.current?.text;

		await handlers["mdhoi4utilities.selectmodfile"]!();

		assert.ok(
			errors.some((message) => message.includes("no workspace")),
			`the failure was not reported: ${JSON.stringify(errors)}`,
		);
		assert.strictEqual(
			modFileStatusContainer.current?.text,
			before,
			"the status bar changed even though nothing was stored",
		);
	});
});
