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
