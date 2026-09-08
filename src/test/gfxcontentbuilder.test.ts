import * as assert from "assert";
import { PNG } from "pngjs";
import * as vscode from "vscode";
import { renderGfxFile } from "../previewdef/gfx/contentbuilder";
import { _clearImageCachesForTest } from "../util/image/imagecache";
import { clearDlcZipCache } from "../util/fileloader";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// Content-level tests for the .gfx preview markup, driving the real image path headlessly the way
// graphicsloader.test.ts does: the vscode stub serves an in-memory file map, and the fixtures are
// PNGs so getImage passes them through without needing the decode worker.
//
// What they guard: a texture named by many spriteTypes must contribute its base64 payload to the
// page once, not once per sprite, and the sprite renders must not all decode at the same time.
describe("previewdef/gfx contentbuilder", function () {
	// relative path -> file bytes served by the stubbed workspace fs.
	let files: Record<string, Buffer> = {};
	// Set by a test that wants to observe or delay the reads renderGfxFile drives.
	let onReadFile: ((relativePath: string) => Promise<void>) | undefined;

	function makePng(width: number, height: number): Buffer {
		const png = new PNG({ width, height });
		png.data.fill(0);
		return PNG.sync.write(png);
	}

	function rel(uri: any): string {
		// The URI round-trips through toString()/parse(), so the fsPath can carry a file:// scheme.
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
	}

	beforeEach(function () {
		files = {};
		onReadFile = undefined;
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
				if (onReadFile) {
					await onReadFile(p);
				}
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

	const webview = {
		asWebviewUri: (u: unknown) => u,
		cspSource: "",
	} as unknown as vscode.Webview;

	function spriteTypes(
		entries: { name: string; texturefile: string }[],
	): string {
		return `spriteTypes = {
${entries
	.map(
		(e) => `    spriteType = {
        name = "${e.name}"
        texturefile = "${e.texturefile}"
    }`,
	)
	.join("\n")}
}`;
	}

	function render(content: string): Promise<{ html: string }> {
		return renderGfxFile(
			content,
			vscode.Uri.file("/ws/interface/test.gfx"),
			webview,
		) as Promise<{ html: string }>;
	}

	function countOccurrences(haystack: string, needle: string): number {
		let count = 0;
		let index = haystack.indexOf(needle);
		while (index !== -1) {
			count++;
			index = haystack.indexOf(needle, index + needle.length);
		}
		return count;
	}

	it("emits a shared texture's base64 payload once, not once per spriteType", async function () {
		files["gfx/interface/shared.png"] = makePng(8, 8);
		const result = await render(
			spriteTypes([
				{ name: "GFX_a", texturefile: "gfx/interface/shared.png" },
				{ name: "GFX_b", texturefile: "gfx/interface/shared.png" },
				{ name: "GFX_c", texturefile: "gfx/interface/shared.png" },
			]),
		);

		assert.strictEqual(
			countOccurrences(result.html, "data:image/png;base64,"),
			1,
			"the shared texture should contribute exactly one data URI",
		);
		for (const name of ["GFX_a", "GFX_b", "GFX_c"]) {
			assert.ok(
				result.html.includes(`id="${name}"`),
				`expected a card for ${name}`,
			);
		}
		assert.strictEqual(
			countOccurrences(result.html, "st-spriteTypePreview"),
			4, // one CSS rule plus one class reference per card
			"all three sprites should still be rendered",
		);
	});

	it("keeps distinct textures apart", async function () {
		files["gfx/interface/one.png"] = makePng(8, 8);
		files["gfx/interface/two.png"] = makePng(16, 4);
		const result = await render(
			spriteTypes([
				{ name: "GFX_one", texturefile: "gfx/interface/one.png" },
				{ name: "GFX_two", texturefile: "gfx/interface/two.png" },
			]),
		);

		assert.strictEqual(
			countOccurrences(result.html, "data:image/png;base64,"),
			2,
			"two textures should contribute two data URIs",
		);
		const textureRules = result.html.match(/\.st-gfx-texture-[\w_]+ \{/g) ?? [];
		assert.strictEqual(textureRules.length, 2);
		assert.ok(result.html.includes("width: 16px;"), "second texture's width");
	});

	it("bounds how many sprite renders decode at once", async function () {
		const spriteCount = 20;
		const entries: { name: string; texturefile: string }[] = [];
		for (let i = 0; i < spriteCount; i++) {
			const texturefile = `gfx/interface/icon${i}.png`;
			files[texturefile] = makePng(4, 4);
			entries.push({ name: `GFX_icon${i}`, texturefile });
		}

		let inFlight = 0;
		let peakInFlight = 0;
		onReadFile = async () => {
			inFlight++;
			peakInFlight = Math.max(peakInFlight, inFlight);
			// One macrotask of delay, so every read that the fan-out started is still open when the
			// next one begins and the peak reflects the real concurrency.
			await new Promise((resolve) => setTimeout(resolve, 1));
			inFlight--;
		};

		const result = await render(spriteTypes(entries));

		assert.ok(
			peakInFlight > 1,
			`expected some concurrency, saw ${peakInFlight}`,
		);
		assert.ok(
			peakInFlight <= 8,
			`expected at most 8 concurrent reads, saw ${peakInFlight}`,
		);
		for (let i = 0; i < spriteCount; i++) {
			assert.ok(
				result.html.includes(`id="GFX_icon${i}"`),
				`expected a card for GFX_icon${i}`,
			);
		}
	});

	it("still renders the MISSING box for a texture that does not exist", async function () {
		const originalConsoleError = console.error;
		console.error = () => undefined;
		try {
			const result = await render(
				spriteTypes([
					{ name: "GFX_gone", texturefile: "gfx/interface/gone.png" },
				]),
			);
			assert.ok(result.html.includes("MISSING"));
			assert.ok(!result.html.includes("data:image/png;base64,"));
		} finally {
			console.error = originalConsoleError;
		}
	});

	it("shares the caption width rule between sprites of equal width", async function () {
		files["gfx/interface/one.png"] = makePng(200, 8);
		files["gfx/interface/two.png"] = makePng(200, 8);
		const result = await render(
			spriteTypes([
				{ name: "GFX_one", texturefile: "gfx/interface/one.png" },
				{ name: "GFX_two", texturefile: "gfx/interface/two.png" },
			]),
		);

		const captionRules = result.html.match(/\.st-imageName-w\d+ \{/g) ?? [];
		assert.deepStrictEqual(captionRules, [".st-imageName-w200 {"]);
	});
});
