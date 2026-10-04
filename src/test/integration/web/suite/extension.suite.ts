import * as vscode from "vscode";

const extensionId = "MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026";
const previewViewType = "mdHoi4Utilities.preview";

suite("VS Code for the Web smoke", () => {
	test("activates the browser bundle and opens an event preview", async () => {
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
		await vscode.commands.executeCommand("mdhoi4utilities.preview");

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
	});
});
