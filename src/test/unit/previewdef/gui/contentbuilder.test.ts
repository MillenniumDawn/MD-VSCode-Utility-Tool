import * as assert from "assert";
import type * as vscode from "vscode";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { LoaderSession } from "../../../../util/loader/loader";
import { GuiFileLoader } from "../../../../previewdef/gui/loader";
import { renderGuiFile } from "../../../../previewdef/gui/contentbuilder";
import { handOver } from "../../host";

const webview = { asWebviewUri: (u: unknown) => u, cspSource: "" } as unknown as vscode.Webview;
const uri = { toString: () => "file:///preview.gui" } as vscode.Uri;

describe("previewdef/gui/contentbuilder", () => {
	beforeEach(() => {
		handOver({ workspace: { getConfiguration: () => ({}) } });
		refreshFeatureFlags();
	});

	afterEach(() => {
		refreshFeatureFlags();
	});

	// A .gfx or .gui edit does not change this file, so the session has to be forced or the loader
	// hands back what it read before.
	it("forces the session on a dependency change", async () => {
		const sessions: LoaderSession[] = [];
		const loader = {
			load: async (session: LoaderSession) => {
				sessions.push(session);
				return { result: { guiFiles: [], gfxFiles: [] }, dependencies: [] };
			},
		} as unknown as GuiFileLoader;

		await renderGuiFile(loader, uri, webview);
		await renderGuiFile(loader, uri, webview, { partial: false, dependencyChanged: true });
		await renderGuiFile(loader, uri, webview, { partial: false, dependencyChanged: false });

		assert.deepStrictEqual(sessions.map((session) => session.force), [false, true, false]);
	});
});
