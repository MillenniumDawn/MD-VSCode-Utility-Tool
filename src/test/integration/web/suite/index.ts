import * as vscode from "vscode";

const extensionId = "MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026";
// Keep this in sync with WebviewType.Preview in src/constants.ts.
const previewViewType = "mdftpreview";

// @vscode/test-web imports this module in the browser extension host. Keep this a plain runner:
// Node-oriented test frameworks such as Mocha are not available to that host.
export async function run(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration("mdHoi4Utilities");
	await configuration.update("eventTreePreview", true, vscode.ConfigurationTarget.Global);
	const eventTreePreview = configuration.get<boolean>("eventTreePreview");
	if (eventTreePreview !== true) {
		throw new Error(`Could not enable the event preview for the browser smoke: ${eventTreePreview}`);
	}

	const extension = vscode.extensions.getExtension(extensionId);
	if (!extension) {
		throw new Error("Extension not found in the browser host");
	}
	await extension.activate();
	if (!extension.isActive) {
		throw new Error("Extension did not activate in the browser host");
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error("Browser smoke workspace did not open");
	}
	const eventUri = vscode.Uri.joinPath(folder.uri, "events", "smoke.txt");
	// Check the browser workspace can serve this exact source, not only open a preview tab.
	const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(eventUri));
	if (!source.includes("id = browser_smoke.1")) {
		throw new Error("Browser smoke event source did not load from the virtual workspace");
	}
	const document = await vscode.workspace.openTextDocument(eventUri);
	await vscode.window.showTextDocument(document);
	const previewCommand = "mdhoi4utilities.preview";
	const registeredCommands = await vscode.commands.getCommands(true);
	if (!registeredCommands.includes(previewCommand)) {
		throw new Error(`Preview command is not registered: ${previewCommand}`);
	}
	// Pass the resource directly because the headless browser host may not keep an active editor.
	try {
		// The command waits for the initial loader read and webview HTML assignment before the test host exits.
		await vscode.commands.executeCommand(previewCommand, eventUri);

		const deadline = Date.now() + 20000;
		while (Date.now() < deadline) {
			const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
			if (tabs.some((tab) => isPreviewTab(tab.input))) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const tabState = vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => {
			const input = tab.input as { constructor?: { name?: string }; viewType?: unknown };
			return {
				label: tab.label,
				inputType: input.constructor?.name,
				viewType: input.viewType,
			};
		});
		throw new Error(`Event preview webview did not open. State: ${JSON.stringify({
			eventUri: eventUri.toString(),
			documentUri: document.uri.toString(),
			eventTreePreview: configuration.get<boolean>("eventTreePreview"),
			activeEditorUri: vscode.window.activeTextEditor?.document.uri.toString(),
			tabs: tabState,
		})}`);
	} catch (error) {
		console.error("Browser smoke preview command failed", error);
		throw error;
	}
}

function isPreviewTab(input: unknown): boolean {
	if (!input || typeof input !== "object") {
		return false;
	}

	// Browser hosts may proxy webview inputs and add the main-thread prefix, so accept
	// that form as well as the canonical view type instead of relying on instanceof.
	const viewType = (input as { viewType?: unknown }).viewType;
	return viewType === previewViewType || viewType === `mainThreadWebview-${previewViewType}`;
}
