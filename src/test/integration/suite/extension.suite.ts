import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const extensionId = "MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026";

// The smallest textures either decoder accepts: one pixel, uncompressed, 32 bits. Written to a
// temp folder per run, so the suite carries no binary fixture.
function tinyTga(): Buffer {
	const header = Buffer.alloc(18);
	header[2] = 2; // uncompressed true-colour
	header.writeUInt16LE(1, 12); // width
	header.writeUInt16LE(1, 14); // height
	header[16] = 32; // bits per pixel
	header[17] = 8; // 8 alpha bits
	return Buffer.concat([header, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
}

function tinyDds(): Buffer {
	const header = Buffer.alloc(128);
	header.write("DDS ", 0, "ascii");
	header.writeUInt32LE(124, 4); // header size
	header.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000, 8); // caps, height, width, pixel format
	header.writeUInt32LE(1, 12); // height
	header.writeUInt32LE(1, 16); // width
	header.writeUInt32LE(4, 20); // pitch
	header.writeUInt32LE(32, 76); // pixel format size
	header.writeUInt32LE(0x40 | 0x1, 80); // RGB with alpha
	header.writeUInt32LE(32, 88); // bits per pixel
	header.writeUInt32LE(0x00ff0000, 92);
	header.writeUInt32LE(0x0000ff00, 96);
	header.writeUInt32LE(0x000000ff, 100);
	header.writeUInt32LE(0xff000000, 104);
	header.writeUInt32LE(0x1000, 108); // DDSCAPS_TEXTURE
	return Buffer.concat([header, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
}

suite("Integration smoke", () => {
	let scratch: string;

	suiteSetup(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "md-utilities-smoke-"));
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		fs.rmSync(scratch, { recursive: true, force: true });
	});

	test("extension is present", async () => {
		assert.ok(vscode.extensions.getExtension(extensionId), "extension not found");
	});

	test("extension activates and registers every contributed command", async () => {
		const ext = vscode.extensions.getExtension(extensionId)!;
		if (!ext.isActive) {
			await ext.activate();
		}
		assert.ok(ext.isActive, "extension failed to activate");

		// Every command the manifest contributes, so a command added to package.json without a
		// registerCommand behind it fails here rather than as "command not found" for a user.
		const contributed: string[] = (ext.packageJSON.contributes?.commands ?? []).map((c: any) => c.command);
		assert.ok(contributed.length >= 4, `only ${contributed.length} commands contributed`);
		const registered = await vscode.commands.getCommands(true);
		for (const id of contributed) {
			assert.ok(registered.includes(id), `command ${id} is contributed but not registered`);
		}
		// Named as well, so dropping either from the manifest fails here too.
		for (const id of ["mdhoi4utilities.scanreferences", "mdhoi4utilities.showindexstatus"]) {
			assert.ok(registered.includes(id), `command ${id} is not registered`);
		}
	});

	test("observes closed workspace, parent, game and DLC files through real filesystem watchers", async () => {
		(globalThis as any).IS_WEB_EXT = false;
		const { handOverHost } = require("../../../util/host") as typeof import("../../../util/host");
		handOverHost(vscode);
		const { createIndexWatchers } = require("../../../util/indexWatchers") as typeof import("../../../util/indexWatchers");
		const { createBuildGate } = require("../../../util/promiseUtils") as typeof import("../../../util/promiseUtils");
		const workspace = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
		const parents = path.join(scratch, "parent");
		const game = path.join(scratch, "game");
		const workspaceRoot = path.join(workspace, "interface");
		const parentRoot = path.join(parents, "interface");
		const gameRoot = path.join(game, "interface");
		const dlcRoot = path.join(game, "dlc", "dlc001");
		for (const root of [workspaceRoot, parentRoot, gameRoot, dlcRoot]) { fs.mkdirSync(root, { recursive: true }); }
		const workspaceFile = path.join(workspaceRoot, "closed.gfx");
		const parentFile = path.join(parentRoot, "closed.gfx");
		const gameFile = path.join(gameRoot, "closed.gfx");
		const zipFile = path.join(dlcRoot, "content.zip");
		for (const file of [parentFile, gameFile, zipFile]) { fs.writeFileSync(file, "OLD"); }
		const settings = vscode.workspace.getConfiguration("mdHoi4Utilities");
		const previousDlc = settings.inspect<boolean>("loadDlcContents")?.globalValue;
		await settings.update("loadDlcContents", true, vscode.ConfigurationTarget.Global);
		let pending: { kind: string; resolve: () => void; reject: (error: Error) => void } | undefined;
		const contents = new Map<string, string>();
		const notify = (kind: string) => { if (pending?.kind === kind) { pending.resolve(); } };
		const gate = createBuildGate();
		gate.start(Promise.resolve());
		const watchers = createIndexWatchers({
			enabled: () => true, extension: ".gfx", hasStarted: () => true, gate,
			rootPrefixes: ["interface/"],
			externalRoots: () => [{ uri: vscode.Uri.file(parents), kind: "parent" }, { uri: vscode.Uri.file(game), kind: "global" }],
			reindexFile: (file) => {
				try { contents.set(file.fsPath, fs.readFileSync(file.fsPath, "utf8")); notify("workspace"); }
				catch (cause) { pending?.reject(cause as Error); }
			},
			removeFile: (file) => { contents.delete(file.fsPath); notify("removed"); },
			globalSourceChanged: (force) => { if (force) { notify("global"); } },
			rebuildWorkspace: { reset() {}, build: async () => undefined, message: "Watching test files", failureMessage: "Watcher test failed" },
			rebuildParent: { reset() {}, build: async () => { contents.set(parentFile, fs.readFileSync(parentFile, "utf8")); notify("parent"); } },
		});
		const registration = watchers.register();
		async function observed(kind: string, action: () => void): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => { pending = undefined; reject(new Error(`No real filesystem notification for ${kind}; contents=${JSON.stringify([...contents])}`)); }, 8000);
				pending = { kind, resolve: () => { clearTimeout(timer); pending = undefined; resolve(); }, reject: (error) => { clearTimeout(timer); pending = undefined; reject(error); } };
				action();
			});
		}
		try {
			// VS Code starts watching asynchronously and has no watcher-ready event.
			const probeFile = path.join(workspaceRoot, ".watcher-ready");
			const probe = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, ".watcher-ready"));
			const ready = vscode.Disposable.from(probe,
				probe.onDidCreate(() => notify("watcher transport")),
				probe.onDidChange(() => notify("watcher transport")));
			let probeWrites = 0;
			function writeProbe(): void {
				probeWrites++;
				try { fs.writeFileSync(probeFile, "READY"); }
				catch (cause) { pending?.reject(cause as Error); }
			}
			const pulse = setInterval(writeProbe, 100);
			try {
				await observed("watcher transport", writeProbe);
				console.log(`Filesystem watcher transport ready after ${probeWrites} probe write(s)`);
			} finally {
				clearInterval(pulse);
				ready.dispose();
				if (fs.existsSync(probeFile)) { fs.unlinkSync(probeFile); }
			}
			await observed("workspace", () => fs.writeFileSync(workspaceFile, "CREATED"));
			assert.strictEqual(contents.get(workspaceFile), "CREATED");
			await observed("workspace", () => fs.writeFileSync(workspaceFile, "CHANGED"));
			assert.strictEqual(contents.get(workspaceFile), "CHANGED");
			await observed("removed", () => fs.unlinkSync(workspaceFile));
			assert.ok(!contents.has(workspaceFile));
			await observed("parent", () => fs.writeFileSync(parentFile, "PARENT_CHANGED"));
			assert.strictEqual(contents.get(parentFile), "PARENT_CHANGED");
			await observed("global", () => fs.writeFileSync(gameFile, "GAME_CHANGED"));
			await observed("global", () => fs.writeFileSync(zipFile, "ARCHIVE_REPLACED"));
			assert.ok(!vscode.workspace.textDocuments.some((document) => [workspaceFile, parentFile, gameFile, zipFile].includes(document.uri.fsPath)));
		} finally {
			registration.dispose();
			handOverHost(undefined);
			await settings.update("loadDlcContents", previousDlc, vscode.ConfigurationTarget.Global);
			for (const file of [workspaceFile, parentFile, gameFile, zipFile]) { if (fs.existsSync(file)) { fs.unlinkSync(file); } }
			for (const directory of [workspaceRoot, parentRoot, gameRoot, dlcRoot, path.dirname(dlcRoot), parents, game]) { fs.rmdirSync(directory); }
		}
	});

	// The manifest saying a custom editor exists is not the same as one being registered: a
	// provider that was never registered leaves `openWith` rejecting. Opening a file with each view
	// type and finding it in a custom-editor tab is the check that means something.
	for (const [viewType, extension, bytes] of [
		["mdhoi4utilities.dds", "dds", tinyDds()],
		["mdhoi4utilities.tga", "tga", tinyTga()],
	] as const) {
		test(`opens a .${extension} file in the ${viewType} custom editor`, async () => {
			const file = path.join(scratch, `one-pixel.${extension}`);
			fs.writeFileSync(file, bytes);
			const uri = vscode.Uri.file(file);

			await vscode.commands.executeCommand("vscode.openWith", uri, viewType);

			const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
			assert.ok(tab, "nothing opened");
			assert.ok(tab.input instanceof vscode.TabInputCustom, `the tab is not a custom editor: ${tab.label}`);
			assert.strictEqual(tab.input.viewType, viewType);
			assert.strictEqual(tab.input.uri.fsPath, uri.fsPath);
		});
	}
});
