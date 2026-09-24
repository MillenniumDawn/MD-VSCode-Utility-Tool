import * as assert from "assert";
import * as vscode from "vscode";
import { JSDOM, VirtualConsole } from "jsdom";
import { DDSViewProvider, TGAViewProvider } from "../ddsviewprovider";
import * as imageDecoder from "../util/image/imagedecoder";
import * as vscodeCommon from "../util/vsccommon";
import { contextContainer } from "../context";

const mutableVscodeCommon = vscodeCommon as {
	readFile: typeof vscodeCommon.readFile;
};
const mutableImageDecoder = imageDecoder as {
	decodeImageToPng: typeof imageDecoder.decodeImageToPng;
};

interface StubPanel {
	webview: {
		html: string;
		cspSource: string;
		options: { enableScripts?: boolean; localResourceRoots?: vscode.Uri[] };
		postMessage(msg: unknown): Promise<boolean>;
		onDidReceiveMessage(listener: (msg: unknown) => void): { dispose(): void };
	};
	onDidDispose(listener: () => void): { dispose(): void };
	posted: unknown[];
	receive(msg: unknown): void;
	dispose(): void;
}

function panel(): StubPanel {
	const posted: unknown[] = [];
	let messageListener: ((msg: unknown) => void) | undefined;
	let disposeListener: (() => void) | undefined;
	return {
		webview: {
			html: "",
			cspSource: "vscode-resource:",
			options: {},
			postMessage: async (msg: unknown) => {
				posted.push(msg);
				return true;
			},
			onDidReceiveMessage: (listener) => {
				messageListener = listener;
				return { dispose: () => { messageListener = undefined; } };
			},
		},
		onDidDispose: (listener) => {
			disposeListener = listener;
			return { dispose: () => undefined };
		},
		posted,
		receive: (msg) => messageListener?.(msg),
		dispose: () => disposeListener?.(),
	};
}

function token(): { onCancellationRequested: () => { dispose(): void } } {
	return { onCancellationRequested: () => ({ dispose: () => undefined }) };
}

describe("DDS and TGA custom editor providers", () => {
	it("opens a custom document without treating it as text", async () => {
		const provider = new DDSViewProvider();
		const uri = vscode.Uri.file("/tmp/image.dds");
		const document = await provider.openCustomDocument(uri);

		assert.strictEqual(document.uri, uri);
		document.dispose();
	});

	const extensionUri = vscode.Uri.file("/ext");

	async function openDecodedImage(
		provider: DDSViewProvider | TGAViewProvider = new TGAViewProvider(),
		source: Buffer = Buffer.from("source"),
		decode: typeof imageDecoder.decodeImageToPng = async () => ({
			pngBuffer: Buffer.from([1, 2]),
			width: 2,
			height: 3,
		}),
	): Promise<StubPanel> {
		const originalReadFile = mutableVscodeCommon.readFile;
		const originalDecode = mutableImageDecoder.decodeImageToPng;
		const originalContext = contextContainer.current;
		contextContainer.current = { extensionUri } as any;
		mutableVscodeCommon.readFile = async () => source;
		mutableImageDecoder.decodeImageToPng = decode;
		try {
			const view = panel();
			await provider.resolveCustomEditor(
				{ uri: vscode.Uri.file("/tmp/image." + (provider instanceof DDSViewProvider ? "dds" : "tga")) } as any,
				view as any,
				token() as any,
			);
			return view;
		} finally {
			mutableVscodeCommon.readFile = originalReadFile;
			mutableImageDecoder.decodeImageToPng = originalDecode;
			contextContainer.current = originalContext;
		}
	}

	function postedImageBytes(view: StubPanel): number[][] {
		return view.posted.map((msg) => {
			const image = msg as { type: string; data: Uint8Array };
			assert.strictEqual(image.type, "image");
			return Array.from(image.data);
		});
	}

	it("renders a sized page and posts the decoded bytes once the page is ready", async () => {
		const view = await openDecodedImage();

		assert.ok(view.webview.html.includes("width:2px;height:3px;"));
		assert.ok(view.webview.html.includes('alt="TGA texture preview"'));
		assert.ok(!view.webview.html.includes("data:image/png;base64"));
		assert.ok(view.webview.html.includes("img-src data: blob:"));
		assert.strictEqual(view.webview.options.enableScripts, true);
		assert.deepStrictEqual(view.webview.options.localResourceRoots, [extensionUri]);
		assert.deepStrictEqual(view.posted, []);

		view.receive({ command: "ready" });

		assert.deepStrictEqual(postedImageBytes(view), [[1, 2]]);
	});

	it("posts the bytes again when the page reloads, and not after the panel is disposed", async () => {
		const view = await openDecodedImage();

		view.receive({ command: "ready" });
		view.receive({ command: "other" });
		view.receive({ command: "ready" });
		assert.deepStrictEqual(postedImageBytes(view), [[1, 2], [1, 2]]);

		view.dispose();
		view.receive({ command: "ready" });
		assert.strictEqual(view.posted.length, 2);
	});

	// The host-side tests above never run the page, which is how a page script that threw on
	// every open shipped with the suite green. These load the html the viewer really gets into a
	// DOM, run its script, and connect it to the host the way VS Code does.
	describe("viewer page", () => {
		interface ViewerPage {
			img: HTMLImageElement;
			blobs: Blob[];
			errors: unknown[];
		}

		async function loadViewerPage(view: StubPanel): Promise<ViewerPage> {
			const blobs: Blob[] = [];
			const errors: unknown[] = [];
			const virtualConsole = new VirtualConsole();
			virtualConsole.on("jsdomError", (e) => errors.push(e));
			const alreadyPosted = view.posted.length;
			const dom = new JSDOM(view.webview.html, {
				runScripts: "dangerously",
				virtualConsole,
				beforeParse(window) {
					(window as any).acquireVsCodeApi = () => ({
						postMessage: (msg: unknown) => view.receive(msg),
						getState: () => undefined,
						setState: () => undefined,
					});
					(window.URL as any).createObjectURL = (blob: Blob) => {
						blobs.push(blob);
						return "blob:test/" + blobs.length;
					};
					(window.URL as any).revokeObjectURL = () => undefined;
				},
			});
			// VS Code delivers host messages asynchronously, after the page has finished loading.
			await new Promise((resolve) => setImmediate(resolve));
			for (const data of view.posted.slice(alreadyPosted)) {
				dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data }));
			}
			return {
				img: dom.window.document.getElementById("texture") as HTMLImageElement,
				blobs,
				errors,
			};
		}

		async function blobBytes(blob: Blob): Promise<number[]> {
			return Array.from(new Uint8Array(await blob.arrayBuffer()));
		}

		it("shows the decoded image once the page has loaded", async () => {
			const view = await openDecodedImage();
			const page = await loadViewerPage(view);

			assert.deepStrictEqual(page.errors, []);
			assert.strictEqual(page.img.getAttribute("src"), "blob:test/1");
			assert.strictEqual(page.blobs.length, 1);
			assert.strictEqual(page.blobs[0].type, "image/png");
			assert.deepStrictEqual(await blobBytes(page.blobs[0]), [1, 2]);
		});

		it("shows the image again when VS Code reloads the page", async () => {
			const view = await openDecodedImage();
			await loadViewerPage(view);
			const reloaded = await loadViewerPage(view);

			assert.deepStrictEqual(reloaded.errors, []);
			assert.strictEqual(reloaded.img.getAttribute("src"), "blob:test/1");
			assert.strictEqual(view.posted.length, 2);
		});

		it("shows a real DDS texture decoded to PNG", async () => {
			const view = await openDecodedImage(
				new DDSViewProvider(),
				makeDds(2, 2),
				async (buffer, kind) => imageDecoder.decodeImageToPngSync(buffer, kind),
			);
			const page = await loadViewerPage(view);

			assert.deepStrictEqual(page.errors, []);
			assert.strictEqual(page.img.getAttribute("alt"), "DDS texture preview");
			assert.strictEqual(page.img.getAttribute("src"), "blob:test/1");
			assert.deepStrictEqual((await blobBytes(page.blobs[0])).slice(0, 4), [0x89, 0x50, 0x4e, 0x47]);
		});
	});

	it("renders an error page when image loading fails", async () => {
		const originalReadFile = mutableVscodeCommon.readFile;
		mutableVscodeCommon.readFile = async () => {
			throw new Error("read failed");
		};
		try {
			const view = panel();
			await new DDSViewProvider().resolveCustomEditor(
				{ uri: vscode.Uri.file("/tmp/image.dds") } as any,
				view as any,
				token() as any,
			);

			assert.ok(view.webview.html.includes("read&nbsp;failed"));
		} finally {
			mutableVscodeCommon.readFile = originalReadFile;
		}
	});
});

// A tiny uncompressed A8R8G8B8 DDS: a 128-byte header followed by width*height*4 bytes of pixels.
function makeDds(width: number, height: number): Buffer {
	const buf = Buffer.alloc(128 + width * height * 4);
	const setInt = (intIndex: number, value: number) => buf.writeUInt32LE(value >>> 0, intIndex * 4);
	setInt(0, 0x20534444); // 'DDS '
	setInt(1, 124); // dwSize
	setInt(2, 0x1 | 0x2 | 0x4 | 0x1000); // CAPS|HEIGHT|WIDTH|PIXELFORMAT
	setInt(3, height);
	setInt(4, width);
	setInt(5, width * 4); // pitch
	setInt(19, 32); // ddspf.dwSize
	setInt(20, 0x40 | 0x1); // DDPF_RGB | DDPF_ALPHA
	setInt(22, 32); // bit count
	setInt(23, 0x00ff0000);
	setInt(24, 0x0000ff00);
	setInt(25, 0x000000ff);
	setInt(26, 0xff000000);
	setInt(27, 0x1000); // DDSCAPS_TEXTURE
	return buf;
}
