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

function panel(): { webview: { html: string; cspSource: string } } {
	return { webview: { html: "", cspSource: "vscode-resource:" } };
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

	it("renders a decoded image with its dimensions", async () => {
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

			assert.ok(view.webview.html.includes("width:2px;height:3px;"));
			assert.ok(view.webview.html.includes("data:image/png;base64,AQI="));
		} finally {
			mutableVscodeCommon.readFile = originalReadFile;
			mutableImageDecoder.decodeImageToPng = originalDecode;
		}
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
