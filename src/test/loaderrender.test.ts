import * as assert from "assert";
import { createHash } from "crypto";
import * as vscode from "vscode";
import { renderBopFile } from "../previewdef/bop/contentbuilder";
import { renderCharacterFile } from "../previewdef/character/contentbuilder";
import { renderIdeaFile } from "../previewdef/idea/contentbuilder";
import { renderDecisionFile } from "../previewdef/decision/contentbuilder";
import { renderEventFile } from "../previewdef/event/contentbuilder";
import { renderMioFile } from "../previewdef/mio/contentbuilder";
import { renderTechnologyFile } from "../previewdef/technology/contentbuilder";
import { normalizeNoncesForHash, renderedHtml } from "../previewdef/loaderpreview";
import { contextContainer } from "../context";

const webview = { asWebviewUri: (u: unknown) => u, cspSource: "" } as unknown as vscode.Webview;
const uri = vscode.Uri.file("/preview.txt");
const cases = [
	{ name: "bop", render: renderBopFile, result: { bops: { bops: [] }, gfxFiles: [], templates: {}, decisions: {} } },
	{ name: "character", render: renderCharacterFile, result: { characters: { characters: [], conditionExprs: [] }, gfxFiles: [], traits: {}, modifierDefinitions: {} } },
	{ name: "idea", render: renderIdeaFile, result: { ideas: { categories: [], conditionExprs: [] }, gfxFiles: [], modifierDefinitions: {}, swaps: [], swapsUnavailable: false } },
	{ name: "decision", render: renderDecisionFile, result: { decisions: { categories: [], conditionExprs: [] }, categories: {}, scriptedGuis: {}, guiWindows: {}, gfxFiles: [], modifierDefinitions: {} } },
	{ name: "event", render: renderEventFile, result: { events: { eventItemsByNamespace: {} }, mainNamespaces: [], gfxFiles: [] } },
	{ name: "mio", render: renderMioFile, result: { mios: [{ id: "test_mio", traits: {}, textHeaders: [] }], gfxFiles: [] } },
	{ name: "technology", render: renderTechnologyFile, result: {
		technologyTrees: [{ startTechnology: "start", folder: "infantry", technologies: [] }],
		guiFiles: [{ file: "countrytechtreeview.gui", data: { guitypes: [{ containerwindowtype: [{ name: "countrytechtreeview", containerwindowtype: [] }] }] } }],
		gfxFiles: [], equipmentArchetypes: {},
	} },
];

describe("loader preview rendering contracts", () => {
	for (const { name, render, result } of cases) {
		it(`${name} forces dependency changes but not ordinary edits`, async () => {
			const forced: boolean[] = [];
			const loader = { file: "preview.txt", load: async (session: { force: boolean }) => {
				forced.push(session.force);
				return { result };
			} } as any;
			await render(loader, uri, webview);
			await render(loader, uri, webview, { partial: false, dependencyChanged: true });
			await render(loader, uri, webview, { partial: false, dependencyChanged: false });
			assert.deepStrictEqual(forced, [false, true, false]);
		});
	}
	it("preserves the full HTML bytes apart from random nonces", async () => {
		const previous = contextContainer.current;
		contextContainer.current = { extensionUri: vscode.Uri.file("/extension") } as typeof previous;
		try {
			const hashes: Record<string, string> = {};
			for (const { name, render, result } of cases) {
				const loader = { file: "preview.txt", load: async () => ({ result }) } as any;
				const rendered = await render(loader, uri, webview);
				assert.ok(typeof rendered !== "string", `${name} must render successfully: ${rendered}`);
				const normalized = normalizeNoncesForHash(renderedHtml(rendered))
					.replace(/window.styleNonce = "[^"]*"/g, 'window.styleNonce = ""');
				hashes[name] = createHash("sha256").update(normalized).digest("hex");
			}
			assert.deepStrictEqual(hashes, {
				bop: "b7bc633f04e203efbe51b0baea4ba809ed21372ee11da34e9320cd79915fdc11",
				character: "452d3ad15573c56dcb76bcdfa42bcdc8d0db344e8401a0f8d76ac1c3585faec3",
				decision: "043bdb408a3f4aa573a662017769dfbbd215e139a76d5660c9466ae301ebd352",
				event: "645ea5311473a9ef81ded8881a0219d5de7842d6e5ffdabd625949c2655900ab",
				idea: "49688e3838f745d0612aaec58a3f46b2983291ba6af5373f914cc8681e016fd9",
				mio: "424e76345db6756fcc84f3d733741f521e5a185e14fc9007306cc8b58ff05408",
				technology: "cc32c8963c6fe8843265609b3a778fee9e00bda7fdb448fb8e1903cfbf119bad",
			});
		} finally {
			contextContainer.current = previous;
		}
	});
});
