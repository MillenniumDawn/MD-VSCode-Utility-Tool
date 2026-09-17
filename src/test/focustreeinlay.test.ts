import * as assert from "assert";
import * as vscode from "vscode";
import { resolveInlayGfxFiles, resolveInlaysForTree } from "../previewdef/focustree/inlay";
import { FocusTreeInlay, FocusTreeInlayRef } from "../previewdef/focustree/schema";
import { clearDlcZipCache } from "../util/fileloader";
import { _clearImageCachesForTest } from "../util/image/imagecache";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

function inlay(id: string, file: string): FocusTreeInlay {
	return {
		id,
		file,
		token: undefined,
		internal: false,
		visible: true,
		position: { x: 0, y: 0 },
		scriptedImages: [],
		scriptedButtons: [],
		conditionExprs: [],
	};
}

function ref(id: string, x: number, y: number): FocusTreeInlayRef {
	return {
		id,
		position: { x, y },
		file: "common/national_focus/test.txt",
		token: undefined,
	};
}

describe("previewdef/focustree inlay resolveInlaysForTree", () => {
	it("resolves multiple refs to their matching inlay", () => {
		const allInlays = [inlay("inlay_a", "a.txt"), inlay("inlay_b", "b.txt")];
		const refs = [ref("inlay_a", 1, 2), ref("inlay_b", 3, 4)];

		const { inlayWindows, warnings } = resolveInlaysForTree(refs, allInlays);

		assert.strictEqual(inlayWindows.length, 2);
		assert.strictEqual(inlayWindows[0].id, "inlay_a");
		assert.deepStrictEqual(inlayWindows[0].position, { x: 1, y: 2 });
		assert.strictEqual(inlayWindows[1].id, "inlay_b");
		assert.deepStrictEqual(inlayWindows[1].position, { x: 3, y: 4 });
		assert.strictEqual(warnings.length, 0);
	});

	it("warns and skips a ref with no matching inlay", () => {
		const allInlays = [inlay("inlay_a", "a.txt")];
		const refs = [ref("missing_inlay", 0, 0)];

		const { inlayWindows, warnings } = resolveInlaysForTree(refs, allInlays);

		assert.strictEqual(inlayWindows.length, 0);
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].source, "missing_inlay");
	});

	it("resolves a duplicated inlay id to the first occurrence", () => {
		const first = inlay("dup_inlay", "first.txt");
		const second = inlay("dup_inlay", "second.txt");
		const refs = [ref("dup_inlay", 5, 6)];

		const { inlayWindows } = resolveInlaysForTree(refs, [first, second]);

		assert.strictEqual(inlayWindows.length, 1);
		assert.strictEqual(inlayWindows[0].file, "first.txt");
	});
});

// The sprite scan walks every .gfx under interface/ until the inlays' sprites are placed. It used
// to parse each one into the shared parse cache, which holds fewer files than the tree has, so a
// refresh started over from the first file. 150 files: past that cache and past the content cache.
describe("previewdef/focustree inlay resolveInlayGfxFiles", function () {
	const fileCount = 150;
	let readsByFile: Map<string, number>;

	function gfxFile(index: number): string {
		return `interface/scan_${index}.gfx`;
	}

	function uriPath(uri: any): string {
		return String(uri.path ?? uri.fsPath ?? "").replace(/\\/g, "/");
	}

	function inlayWithSprite(gfxName: string): FocusTreeInlay {
		const result = inlay("inlay_a", "common/focus_inlay_windows/a.txt");
		result.scriptedImages = [
			{
				id: "slot",
				file: result.file,
				token: undefined,
				gfxOptions: [{ gfxName, condition: true, file: result.file, token: undefined }],
			},
		];
		return result;
	}

	beforeEach(function () {
		readsByFile = new Map();
		stubVscode({
			now: () => 4000,
			configuration: { loadDlcContents: false },
			stat: async (uri: any) => ({
				type: uriPath(uri).endsWith("/interface") ? vscode.FileType.Directory : vscode.FileType.File,
				mtime: 1,
				ctime: 0,
				size: 0,
			}),
			readDirectory: async (uri: any) => {
				if (!uriPath(uri).endsWith("/ws/interface")) {
					return [];
				}
				return Array.from({ length: fileCount }, (_, i): [string, number] => [`scan_${i}.gfx`, vscode.FileType.File]);
			},
			readFile: async (uri: any) => {
				const p = uriPath(uri);
				const file = p.substring(p.indexOf("interface/"));
				readsByFile.set(file, (readsByFile.get(file) ?? 0) + 1);
				const index = /scan_(\d+)\.gfx$/.exec(file)?.[1];
				return Buffer.from(`spriteTypes = {\n\tspriteType = { name = "GFX_sprite_${index}" texturefile = "gfx/${index}.dds" }\n}`);
			},
			workspaceFolders: [
				{ uri: { fsPath: "/ws", path: "/ws", scheme: "file", toString: () => "file:///ws" } },
			],
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		_clearImageCachesForTest();
		await clearDlcZipCache();
	});

	function totalReads(): number {
		let total = 0;
		for (const count of readsByFile.values()) {
			total += count;
		}
		return total;
	}

	it("places a sprite defined deep in the tree and reads nothing again on the next resolve", async function () {
		const first = inlayWithSprite("GFX_sprite_140");
		const resolution = await resolveInlayGfxFiles([first]);
		assert.deepStrictEqual(resolution.resolvedFiles, [gfxFile(140)]);
		assert.strictEqual(first.scriptedImages[0]!.gfxOptions[0]!.gfxFile, gfxFile(140));
		const coldReads = totalReads();
		assert.ok(coldReads >= 141, `cold scan must reach file 140, read ${coldReads}`);

		const second = inlayWithSprite("GFX_sprite_140");
		await resolveInlayGfxFiles([second]);
		assert.strictEqual(second.scriptedImages[0]!.gfxOptions[0]!.gfxFile, gfxFile(140));
		assert.strictEqual(totalReads(), coldReads, "a warm resolve read a file again");
	});

	it("stops after the batch that placed the last sprite", async function () {
		const target = inlayWithSprite("GFX_sprite_2");
		await resolveInlayGfxFiles([target]);
		assert.strictEqual(target.scriptedImages[0]!.gfxOptions[0]!.gfxFile, gfxFile(2));
		assert.ok(totalReads() <= 16, `read ${totalReads()} files for a sprite in file 2`);
	});

	it("leaves a sprite no file defines unplaced", async function () {
		const target = inlayWithSprite("GFX_nowhere");
		const resolution = await resolveInlayGfxFiles([target]);
		assert.deepStrictEqual(resolution.resolvedFiles, []);
		assert.strictEqual(target.scriptedImages[0]!.gfxOptions[0]!.gfxFile, undefined);
	});
});
