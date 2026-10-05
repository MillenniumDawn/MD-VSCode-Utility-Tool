const vscode = require("vscode");

// VS Code loads extension tests as CommonJS in the browser extension host.
exports.run = async function () {
	const extension = vscode.extensions.getExtension("MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026");
	if (!extension) {
		throw new Error("The extension was not loaded from its browser entrypoint.");
	}
	await extension.activate();
	if (!extension.isActive) {
		throw new Error("The browser extension did not activate.");
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error("The browser smoke workspace did not open.");
	}
	const uri = vscode.Uri.joinPath(folder.uri, "common", "national_focus", "web-smoke.txt");
	const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	if (!source.includes("id = web_smoke_focus")) {
		throw new Error("The browser workspace did not serve the focus tree fixture.");
	}
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document);

	const previewCommand = "mdhoi4utilities.preview";
	const commands = await vscode.commands.getCommands(true);
	if (!commands.includes(previewCommand)) {
		throw new Error("The preview command is not registered.");
	}
	// This command completes only after the initial preview content has rendered.
	await vscode.commands.executeCommand(previewCommand, uri);

	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
		if (tabs.some((tab) => isPreviewTab(tab.input))) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => {
		const input = tab.input;
		return { label: tab.label, viewType: input && typeof input === "object" ? input.viewType : undefined };
	});
	throw new Error(`The event preview webview did not open: ${JSON.stringify(tabs)}`);
};

function isPreviewTab(input) {
	if (!input || typeof input !== "object") {
		return false;
	}
	const viewType = input.viewType;
	return viewType === "mdftpreview" || viewType === "mainThreadWebview-mdftpreview";
}
