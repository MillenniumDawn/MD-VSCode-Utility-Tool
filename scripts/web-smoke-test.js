/* global define */

// VS Code for the Web loads extension test modules through its AMD loader. Keep this smoke test
// dependency-free so it runs in the browser extension host, not under Node's desktop host.
define(['require', 'exports', 'vscode'], function (require, exports, vscode) {
	'use strict';

	exports.run = async function () {
		const extension = vscode.extensions.getExtension('MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026');
		if (!extension) {
			throw new Error('Extension was not loaded from its browser entrypoint.');
		}
		await extension.activate();
		if (!extension.isActive) {
			throw new Error('Browser extension did not activate.');
		}

		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace) {
			throw new Error('The web smoke test needs its fixture workspace.');
		}
		const uri = vscode.Uri.joinPath(workspace.uri, 'common', 'national_focus', 'web-smoke.txt');
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspace.uri, 'common', 'national_focus'));
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`focus_tree = {
	id = web_smoke
	focus = {
		id = web_smoke_focus
		x = 0
		y = 0
		cost = 1
		completion_reward = { }
	}
}
`));

		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('mdhoi4utilities.preview');

		const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
		if (!tab || !(tab.input instanceof vscode.TabInputWebview)) {
			throw new Error('Preview command did not open a webview panel.');
		}
		if (tab.input.viewType !== 'mdftpreview') {
			throw new Error(`Unexpected preview panel type: ${tab.input.viewType}`);
		}
	};
});
