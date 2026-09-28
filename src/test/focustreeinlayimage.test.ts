import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { buildFocusTreePayload } from "../previewdef/focustree/contentbuilder";
import { _clearImageCachesForTest } from "../util/image/imagecache";
import {
	_setImageWorkerPathForTest,
	_resetImageWorkerPathForTest,
	_terminateImageWorkerForTest,
} from "../util/image/imagedecoder";
import { clearDlcZipCache } from "../util/fileloader";
import { parseHoi4File, resolveScriptVariables } from "../hoiformat/hoiparser";
import { convertNodeToJson } from "../hoiformat/schema";
import { GuiFile, guiFileSchema } from "../hoiformat/gui";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
// Imported only so tsc emits the worker file into this test's outDir.
import "../util/image/imageWorker";

// A tiny uncompressed A8R8G8B8 DDS, as in graphicsloader.test.ts.
function makeDds(width: number, height: number): Buffer {
	const bytesPerRow = (32 * width + 7) >>> 3;
	const buf = Buffer.alloc(128 + bytesPerRow * height);
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const setInt = (intIndex: number, value: number) => dv.setInt32(intIndex * 4, value, true);
	setInt(0, 0x20534444);
	setInt(1, 124);
	setInt(2, 0x1 | 0x2 | 0x4 | 0x1000);
	setInt(3, height);
	setInt(4, width);
	setInt(5, bytesPerRow);
	setInt(19, 32);
	setInt(20, 0x40 | 0x1);
	setInt(22, 32);
	setInt(23, 0x00ff0000);
	setInt(24, 0x0000ff00);
	setInt(25, 0x000000ff);
	dv.setUint32(26 * 4, 0xff000000, true);
	setInt(27, 0x1000);
	return buf;
}

// Millennium Dawn's China inlay picks the leader portrait from `check_variable = { CHI_ic_leader = N }`
// options. The webview swaps the slot's class for the option whose condition is selected, so the
// slot must carry no background of its own: one baked in from the first option sat later in the
// stylesheet and always won, leaving the first portrait on screen whatever was chosen.
describe("previewdef/focustree inlay scripted images", function () {
	let files: Record<string, Buffer> = {};

	before(function () {
		_setImageWorkerPathForTest(path.resolve(__dirname, "../util/image/imageWorker.js"));
	});

	after(async function () {
		await _terminateImageWorkerForTest();
		_resetImageWorkerPathForTest();
	});

	beforeEach(function () {
		files = {};
		const rel = (uri: any) => String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
		stubVscode({
			configuration: { modFile: "", installPath: "", loadDlcContents: false },
			workspaceFolders: [{ uri: { fsPath: "/ws", path: "/ws", scheme: "file", toString: () => "file:///ws" } }],
			stat: async (uri: any) => {
				if (rel(uri) in files) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + rel(uri));
			},
			readFile: async (uri: any) => {
				const buf = files[rel(uri)];
				if (buf) {
					return buf;
				}
				throw new Error("not found: " + rel(uri));
			},
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache();
		_clearImageCachesForTest();
	});

	it("leaves the slot's image to the option the webview selects", async function () {
		files["interface/leaders.gfx"] = Buffer.from(`spriteTypes = {
			spriteType = { name = "GFX_leader_jiang" texturefile = "gfx/leaders/jiang.dds" }
			spriteType = { name = "GFX_leader_hu" texturefile = "gfx/leaders/hu.dds" }
		}`);
		files["gfx/leaders/jiang.dds"] = makeDds(8, 8);
		files["gfx/leaders/hu.dds"] = makeDds(8, 8);

		const gui = convertNodeToJson<GuiFile>(resolveScriptVariables(parseHoi4File(`guiTypes = {
			containerWindowType = {
				name = "leader_inlay_window"
				position = { x = 0 y = 0 }
				size = { width = 100 height = 100 }
				iconType = {
					name = "leader_slot"
					spriteType = "GFX_leader_jiang"
					position = { x = 10 y = 10 }
				}
			}
		}`)), guiFileSchema);
		const option = (gfxName: string, condition: any) => ({
			gfxName, condition, gfxFile: "interface/leaders.gfx", file: "common/focus_inlay_windows/test.txt",
		});
		const tree = {
			id: "test_tree",
			focuses: {},
			inlayWindowRefs: [],
			inlayWindows: [{
				id: "leader_inlay",
				file: "common/focus_inlay_windows/test.txt",
				token: undefined,
				windowName: "leader_inlay_window",
				guiWindow: gui.guitypes[0].containerwindowtype[0],
				internal: true,
				visible: true,
				position: { x: 0, y: 0 },
				scriptedImages: [{
					id: "leader_slot",
					file: "common/focus_inlay_windows/test.txt",
					gfxOptions: [
						option("GFX_leader_jiang", { scopeName: "", nodeContent: "has_country_leader = { name = \"Jiang Zemin\" }" }),
						option("GFX_leader_hu", { scopeName: "", nodeContent: "check_variable = { CHI_ic_leader = 2 }" }),
					],
				}],
				scriptedButtons: [],
				conditionExprs: [],
			}],
			warnings: [],
			allowBranchOptions: [],
			conditionExprs: [],
		};
		const loader: any = {
			file: "common/national_focus/test.txt",
			load: async () => ({ result: { focusTrees: [tree], gfxFiles: ["interface/leaders.gfx"] } }),
		};

		const payload = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.ok(payload);
		const template = payload!.renderedInlayWindows["leader_inlay"];
		assert.ok(template.includes("{{inlay_slot_class:leader_slot}}"), "expected the slot placeholder");

		// The element that takes the placeholder must get its image from no other class.
		const slotClasses = /class="([^"]*\{\{inlay_slot_class:leader_slot\}\}[^"]*)"/.exec(template)![1].split(/\s+/);
		const css = payload!.styleTable.toRawCss().replace(/\s+/g, " ");
		for (const cls of slotClasses.filter(c => c && !c.startsWith("{{"))) {
			const rule = new RegExp(`\\.${cls} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
			assert.ok(!/background/.test(rule), `expected no background on ${cls}: ${rule}`);
		}

		// Both options have their own background rule to be swapped in.
		assert.ok(/\.st-inlay-gfx-[^{]*gfx_leader_jiang \{[^}]*background-image/i.test(css), "expected the first option's rule");
		assert.ok(/\.st-inlay-gfx-[^{]*gfx_leader_hu \{[^}]*background-image/i.test(css), "expected the second option's rule");
	});
});
