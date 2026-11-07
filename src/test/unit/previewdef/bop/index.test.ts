import * as assert from "assert";
import type * as vscode from "vscode";
import { PNG } from "pngjs";
import * as contentbuilder from "../../../../previewdef/bop/contentbuilder";
import * as fileloader from "../../../../util/fileloader";
import * as gfxindex from "../../../../util/gfxindex";
import * as guiwindowindex from "../../../../util/guiwindowindex";
import { BopLoader } from "../../../../previewdef/bop/loader";
import type { PreviewBase } from "../../../../previewdef/previewbase";
import { LoaderSession } from "../../../../util/loader/loader";
import { RenderContentOptions } from "../../../../previewdef/loaderpreview";
import { _clearImageCachesForTest, getSpriteByGfxName } from "../../../../util/image/imagecache";
import { fresh, handOver } from "../../host";

it("reloads BoP decision icons from new GFX settings without changing the document", async () => {
	const originals = { fileloader: { ...fileloader }, gfxindex: { ...gfxindex }, guiwindowindex: { ...guiwindowindex }, contentbuilder: { ...contentbuilder } };
	const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
	const files: Record<string, Buffer> = {
		"interface/old.gfx": Buffer.from("spriteTypes = {}"),
		"interface/new.gfx": Buffer.from('spriteTypes = { spriteType = { name = GFX_decision_new texturefile = "gfx/new.png" } }'),
		"interface/powerbalanceview.gfx": Buffer.from("spriteTypes = {}"),
		"gfx/new.png": png,
	};
	const config = { decisionGfxFiles: ["interface/old.gfx"], gfxIndex: false };
	const uri = { scheme: "file", fsPath: "/mod/common/bop/test.txt", toString: () => "file:///mod/common/bop/test.txt" } as vscode.Uri;
	const document = { uri, getText: () => "balance = { initial_value = 0 decision_category = test }" } as vscode.TextDocument;
	const disposable = { dispose() {} };
	let fire!: (event: vscode.ConfigurationChangeEvent) => void;
	handOver({
		EventEmitter: class {
			event = () => disposable;
			fire() {}
			dispose() {}
		} as any,
		Disposable: { from: () => disposable } as any,
		workspace: {
			getWorkspaceFolder: () => undefined,
			textDocuments: [document],
			getConfiguration: (() => config) as any,
			onDidChangeConfiguration: (handler: any) => { fire = handler; return disposable; },
		},
	});
	Object.assign(fileloader, {
		getDescriptorDecisionGfx: async () => [],
		getFilePathFromModOrHOI4: async (file: string) => files[file] ? file : undefined,
		readFileFromModOrHOI4: async (file: string) => [files[file], file],
		hoiFileExpiryToken: async () => "unchanged",
		listFilesFromModOrHOI4: async () => [],
	});
	Object.assign(gfxindex, { getGfxContainerFiles: async () => [], getGfxContainerFile: async () => undefined });
	Object.assign(guiwindowindex, { findContainerWindows: async () => ({}) });
	const forces: boolean[] = [];
	Object.assign(contentbuilder, {
		renderBopFile: async (loader: BopLoader, _uri: vscode.Uri, _webview: vscode.Webview, options?: RenderContentOptions) => {
			forces.push(options?.dependencyChanged ?? false);
			const loaded = await loader.load(new LoaderSession(options?.dependencyChanged ?? false));
			return await getSpriteByGfxName("GFX_decision_new", loaded.result.gfxFiles) ? "resolved" : "missing";
		},
	});
	_clearImageCachesForTest();
	let preview: PreviewBase | undefined;
	try {
		const { bopPreviewDef } = fresh<typeof import("../../../../previewdef/bop")>("../../previewdef/bop");
		const panel = {
			visible: true,
			webview: { html: "", onDidReceiveMessage: () => disposable },
			onDidDispose: () => disposable,
			onDidChangeViewState: () => disposable,
		} as unknown as vscode.WebviewPanel;
		assert.ok("previewConstructor" in bopPreviewDef);
		preview = new bopPreviewDef.previewConstructor(uri, panel);
		await preview.onDocumentChange(document);
		assert.strictEqual(panel.webview.html, "missing");
		config.decisionGfxFiles = ["interface/new.gfx"];
		fire({ affectsConfiguration: (key: string) => key === "mdHoi4Utilities.decisionGfxFiles" } as vscode.ConfigurationChangeEvent);
		await preview.onDocumentChange(document);
		assert.strictEqual(panel.webview.html, "resolved");
		assert.deepStrictEqual(forces, [false, true]);
	} finally {
		preview?.dispose();
		Object.assign(fileloader, originals.fileloader);
		Object.assign(gfxindex, originals.gfxindex);
		Object.assign(guiwindowindex, originals.guiwindowindex);
		Object.assign(contentbuilder, originals.contentbuilder);
		_clearImageCachesForTest();
	}
});
