import * as assert from "assert";
import * as path from "path";
import { PNG } from "pngjs";
import * as vscode from "vscode";
import {
	getImageByPath,
	getSpriteByGfxName,
	_clearImageCachesForTest,
} from "../util/image/imagecache";
import {
	_setImageWorkerPathForTest,
	_terminateImageWorkerForTest,
} from "../util/image/imagedecoder";
import { clearDlcZipCache } from "../util/fileloader";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
// Imported only so tsc emits the worker file into this test's outDir; it is import-safe on the main
// thread (its message handler attaches only when actually run as a worker_threads worker).
import "../util/image/imageworker";

// A tiny uncompressed A8R8G8B8 (DDPF_RGB|DDPF_ALPHA, 32bpp) DDS. Header is 32 little-endian int32s
// followed by width*height*4 bytes of pixel data.
function makeDds(width: number, height: number): Buffer {
	const bytesPerRow = (32 * width + 7) >>> 3;
	const pixelBytes = bytesPerRow * height;
	const buf = Buffer.alloc(128 + pixelBytes);
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const setInt = (intIndex: number, value: number) =>
		dv.setInt32(intIndex * 4, value, true);
	setInt(0, 0x20534444); // DDS magic 'DDS '
	setInt(1, 124); // dwSize
	setInt(2, 0x1 | 0x2 | 0x4 | 0x1000); // dwFlags: CAPS|HEIGHT|WIDTH|PIXELFORMAT
	setInt(3, height);
	setInt(4, width);
	setInt(5, bytesPerRow); // dwPitchOrLinearSize
	setInt(19, 32); // ddspf.dwSize
	setInt(20, 0x40 | 0x1); // ddspf.dwFlags: DDPF_RGB | DDPF_ALPHA
	setInt(22, 32); // dwRGBBitCount
	setInt(23, 0x00ff0000); // R mask
	setInt(24, 0x0000ff00); // G mask
	setInt(25, 0x000000ff); // B mask
	dv.setUint32(26 * 4, 0xff000000, true); // A mask
	setInt(27, 0x1000); // dwCaps: DDSCAPS_TEXTURE (no mipmap)
	for (let p = 0; p < pixelBytes; p++) {
		buf[128 + p] = (p * 37) & 0xff;
	}
	return buf;
}

const TGA = require("tga") as typeof import("tga");

// A tiny 2x2 RGBA TGA built with the same library the converter uses.
function makeTga(): Buffer {
	const rgba = [
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 128,
	];
	return TGA.createTgaBuffer(2, 2, rgba as unknown as [], false);
}

function makePng(width: number, height: number): Buffer {
	const png = new PNG({ width, height });
	png.data.fill(0);
	return PNG.sync.write(png);
}

function spyConsoleError(): { calls: unknown[][]; restore: () => void } {
	const original = console.error;
	const calls: unknown[][] = [];
	console.error = (...args: unknown[]) => {
		calls.push(args);
	};
	return {
		calls,
		restore: () => {
			console.error = original;
		},
	};
}

function assertValidPng(
	pngBuffer: Buffer,
	width: number,
	height: number,
): void {
	assert.ok(pngBuffer.length > 0, "pngBuffer should be non-empty");
	assert.strictEqual(pngBuffer[0], 0x89, "PNG signature byte 0");
	const decoded = PNG.sync.read(pngBuffer);
	assert.strictEqual(decoded.width, width);
	assert.strictEqual(decoded.height, height);
	assert.strictEqual(decoded.data.length, width * height * 4);
}

// Headless exercise of the real graphics loader (imagecache.ts) end to end: path resolution through
// fileloader, file read, and DDS/TGA/PNG -> PNG decode through the worker pool. No VS Code or HOI4
// install is needed; the vscode stub serves a fake workspace whose fs.stat/readFile answer from an
// in-memory file map. This is the path a focus tree / gfx preview actually drives.
describe("util/image/graphicsloader (headless)", function () {
	// relative path -> file bytes served by the stubbed workspace fs.
	let files: Record<string, Buffer> = {};

	before(function () {
		_setImageWorkerPathForTest(
			path.resolve(__dirname, "../util/image/imageworker.js"),
		);
	});

	after(async function () {
		await _terminateImageWorkerForTest();
	});

	beforeEach(function () {
		files = {};
		stubVscode({
			configuration: { modFile: "", installPath: "", loadDlcContents: false },
			workspaceFolders: [
				{
					uri: {
						fsPath: "/ws",
						path: "/ws",
						scheme: "file",
						toString: () => "file:///ws",
					},
				},
			],
			stat: async (uri: any) => {
				const p = rel(uri);
				if (p in files) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + p);
			},
			readFile: async (uri: any) => {
				const p = rel(uri);
				const buf = files[p];
				if (buf) {
					return buf;
				}
				throw new Error("not found: " + p);
			},
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache();
		_clearImageCachesForTest();
	});

	function rel(uri: any): string {
		// The URI round-trips through toString()/parse(), so the fsPath can carry a file:// scheme.
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
	}

	it("decodes a DDS texture to an Image with correct dimensions", async function () {
		files["gfx/interface/goals/foo.dds"] = makeDds(8, 8);
		const image = await getImageByPath("gfx/interface/goals/foo.dds");
		assert.ok(image, "expected a decoded image");
		assert.strictEqual(image!.width, 8);
		assert.strictEqual(image!.height, 8);
		assertValidPng(image!.pngBuffer, 8, 8);
	});

	it("decodes a TGA texture to an Image", async function () {
		files["gfx/interface/goals/bar.tga"] = makeTga();
		const image = await getImageByPath("gfx/interface/goals/bar.tga");
		assert.ok(image, "expected a decoded image");
		assert.strictEqual(image!.width, 2);
		assert.strictEqual(image!.height, 2);
		assertValidPng(image!.pngBuffer, 2, 2);
	});

	it("passes a PNG through without re-encoding", async function () {
		const png = makePng(4, 4);
		files["gfx/interface/goals/baz.png"] = png;
		const image = await getImageByPath("gfx/interface/goals/baz.png");
		assert.ok(image, "expected a decoded image");
		assert.strictEqual(image!.width, 4);
		assert.strictEqual(image!.height, 4);
		assert.ok(
			image!.pngBuffer.equals(png),
			"PNG passthrough should keep the same buffer",
		);
	});

	it("resolves a sprite from a gfx file through the loader", async function () {
		files["interface/goals.gfx"] = Buffer.from(
			'spriteTypes = { spritetype = { name = "GFX_foo" texturefile = "gfx/interface/goals/foo.dds" noofframes = 1 } }',
		);
		files["gfx/interface/goals/foo.dds"] = makeDds(8, 8);
		const sprite = await getSpriteByGfxName("GFX_foo", "interface/goals.gfx");
		assert.ok(sprite, "expected a resolved sprite");
		assert.strictEqual(sprite!.image.width, 8);
		assert.strictEqual(sprite!.image.height, 8);
	});

	it("decodes many textures concurrently through the worker pool", async function () {
		for (let i = 0; i < 8; i++) {
			files[`gfx/interface/goals/icon${i}.dds`] = makeDds(4, 4);
		}
		const images = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				getImageByPath(`gfx/interface/goals/icon${i}.dds`),
			),
		);
		images.forEach((image, i) => {
			assert.ok(image, `expected image ${i}`);
			assert.strictEqual(image!.width, 4);
			assert.strictEqual(image!.height, 4);
		});
	});

	it("returns undefined for a missing texture and does not log it to console.error", async function () {
		const spy = spyConsoleError();
		try {
			const image = await getImageByPath("gfx/interface/goals/missing.dds");
			assert.strictEqual(image, undefined);
			assert.strictEqual(
				spy.calls.length,
				0,
				"a missing file is an expected UserError and should not be dumped to console.error",
			);
		} finally {
			spy.restore();
		}
	});

	it("returns undefined for an unsupported image type and does not log it to console.error", async function () {
		files["gfx/interface/goals/qux.bmp"] = Buffer.from("not a real image");
		const spy = spyConsoleError();
		try {
			const image = await getImageByPath("gfx/interface/goals/qux.bmp");
			assert.strictEqual(image, undefined);
			assert.strictEqual(
				spy.calls.length,
				0,
				"an unsupported image type is an expected UserError and should not be dumped to console.error",
			);
		} finally {
			spy.restore();
		}
	});

	it("logs a genuine decode failure to console.error", async function () {
		// Too short to hold a TGA header, so the tga library throws a plain RangeError rather than a UserError.
		files["gfx/interface/goals/corrupt.tga"] = Buffer.alloc(4);
		const spy = spyConsoleError();
		try {
			const image = await getImageByPath("gfx/interface/goals/corrupt.tga");
			assert.strictEqual(image, undefined);
			assert.ok(
				spy.calls.length > 0,
				"a real decode failure should still be logged to console.error",
			);
		} finally {
			spy.restore();
		}
	});
});
