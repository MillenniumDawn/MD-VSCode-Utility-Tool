import * as vscode from "vscode";

const extensionId = "MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026";
// Keep this in sync with WebviewType.Preview in src/constants.ts.
const previewViewType = "mdftpreview";

// @vscode/test-web imports this module in the browser extension host. Keep this a plain runner:
// Node-oriented test frameworks such as Mocha are not available to that host.
export async function run(): Promise<void> {
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
	const document = await vscode.workspace.openTextDocument(eventUri);
	await vscode.window.showTextDocument(document);
	// Pass the resource directly because the headless browser host may not keep an active editor.
	await vscode.commands.executeCommand("mdhoi4utilities.preview", eventUri);

	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const opened = vscode.window.tabGroups.all.some((group) =>
			group.tabs.some((tab) =>
				tab.input instanceof vscode.TabInputWebview && tab.input.viewType === previewViewType,
			),
		);
		if (opened) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Event preview webview did not open in the browser host");
}
