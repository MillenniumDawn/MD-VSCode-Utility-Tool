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
	const waitForFocusTreeDomRender = extension.exports?.waitForFocusTreeDomRender;
	const cancelFocusTreeDomRenderWait = extension.exports?.cancelFocusTreeDomRenderWait;
	if (typeof waitForFocusTreeDomRender !== "function" || typeof cancelFocusTreeDomRenderWait !== "function") {
		throw new Error("The extension did not expose the bounded focus-tree DOM render acknowledgement.");
	}
	// Arm the host waiter before opening the preview so an early webview acknowledgement cannot be lost.
	const uriKey = uri.toString();
	const renderedDomAck = waitForFocusTreeDomRender(uriKey, 70000);
	try {
		// This command completes only after the initial preview content has rendered.
		const [renderedFocusIds] = await Promise.all([
			renderedDomAck,
			vscode.commands.executeCommand(previewCommand, uri),
		]);
		assertRenderedFocusIds(renderedFocusIds, ["web_smoke_focus"]);
	} finally {
		// A command failure must not leave its 70 second acknowledgement timer alive.
		cancelFocusTreeDomRenderWait(uriKey);
	}

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
	throw new Error(`The focus-tree preview webview did not open: ${JSON.stringify(tabs)}`);
};

// Keep the browser-loaded test entrypoint self-contained; VS Code for the Web loads this
// file directly and does not resolve sibling CommonJS modules in the extension tests path.
function assertRenderedFocusIds(renderedFocusIds, expectedFocusIds) {
	if (!Array.isArray(renderedFocusIds) || renderedFocusIds.length === 0) {
		throw new Error("The focus-tree webview did not acknowledge any mounted focus elements.");
	}
	if (!renderedFocusIds.every((id) => typeof id === "string" && id.length > 0)) {
		throw new Error("The focus-tree webview acknowledgement contained invalid focus ids.");
	}

	const rendered = [...renderedFocusIds].sort();
	const expected = [...expectedFocusIds].sort();
	if (JSON.stringify(rendered) !== JSON.stringify(expected)) {
		throw new Error(
			`The focus-tree webview rendered [${rendered.join(", ")}], expected [${expected.join(", ")}].`,
		);
	}
	return renderedFocusIds;
}

function isPreviewTab(input) {
	if (!input || typeof input !== "object") {
		return false;
	}
	const viewType = input.viewType;
	return viewType === "mdftpreview" || viewType === "mainThreadWebview-mdftpreview";
}

exports.assertRenderedFocusIds = assertRenderedFocusIds;
