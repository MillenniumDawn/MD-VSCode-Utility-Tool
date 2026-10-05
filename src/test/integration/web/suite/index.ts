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
	const document = await vscode.workspace.openTextDocument(eventUri);
	await vscode.window.showTextDocument(document);
	const previewCommand = "mdhoi4utilities.preview";
	const registeredCommands = await vscode.commands.getCommands(true);
	if (!registeredCommands.includes(previewCommand)) {
		throw new Error(`Preview command is not registered: ${previewCommand}`);
	}
	const notifications: string[] = [];
	const restoreInformation = captureMessage(
		"showInformationMessage",
		"information",
		vscode.window.showInformationMessage.bind(vscode.window),
		notifications,
	);
	const restoreError = captureMessage(
		"showErrorMessage",
		"error",
		vscode.window.showErrorMessage.bind(vscode.window),
		notifications,
	);
	console.log("Browser smoke before preview command", {
		eventUri: eventUri.toString(),
		documentUri: document.uri.toString(),
		eventTreePreview,
		eventTextLength: document.getText().length,
		registeredPreviewCommand: true,
		activeEditorUri: vscode.window.activeTextEditor?.document.uri.toString(),
	});
	// Pass the resource directly because the headless browser host may not keep an active editor.
	try {
		await vscode.commands.executeCommand(previewCommand, eventUri);

		const deadline = Date.now() + 20000;
		while (Date.now() < deadline) {
			const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
			if (tabs.some((tab) =>
				tab.input instanceof vscode.TabInputWebview && tab.input.viewType === previewViewType,
			)) {
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
			notifications,
		})}`);
	} catch (error) {
		console.error("Browser smoke preview command failed", error);
		throw error;
	} finally {
		restoreInformation();
		restoreError();
	}
}

function captureMessage(
	method: "showInformationMessage" | "showErrorMessage",
	kind: string,
	show: (message: string) => unknown,
	notifications: string[],
): () => void {
	const original = Object.getOwnPropertyDescriptor(vscode.window, method);
	try {
		Object.defineProperty(vscode.window, method, {
			configurable: true,
			value: (message: string) => {
				notifications.push(`${kind}: ${message}`);
				return show(message);
			},
		});
	} catch (error) {
		console.warn(`Could not capture VS Code ${method} notifications`, error);
		return () => undefined;
	}
	return () => {
		if (original) {
			Object.defineProperty(vscode.window, method, original);
		} else {
			Reflect.deleteProperty(vscode.window, method);
		}
	};
}
