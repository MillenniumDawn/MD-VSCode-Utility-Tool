import * as assert from "assert";
import * as vscode from "vscode";
import { DDSViewProvider, TGAViewProvider } from "../ddsviewprovider";
import * as imageDecoder from "../util/image/imagedecoder";
import * as vscodeCommon from "../util/vsccommon";

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
		options: { enableScripts?: boolean };
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

	async function openDecodedImage(): Promise<StubPanel> {
		const originalReadFile = mutableVscodeCommon.readFile;
		const originalDecode = mutableImageDecoder.decodeImageToPng;
		mutableVscodeCommon.readFile = async () => Buffer.from("source");
		mutableImageDecoder.decodeImageToPng = async () => ({
			pngBuffer: Buffer.from([1, 2]),
			width: 2,
			height: 3,
		});
		try {
			const view = panel();
			await new TGAViewProvider().resolveCustomEditor(
				{ uri: vscode.Uri.file("/tmp/image.tga") } as any,
				view as any,
				token() as any,
			);
			return view;
		} finally {
			mutableVscodeCommon.readFile = originalReadFile;
			mutableImageDecoder.decodeImageToPng = originalDecode;
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
