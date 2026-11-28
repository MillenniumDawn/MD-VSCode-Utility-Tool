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
	{ name: "event", render: renderEventFile, result: { events: { eventItemsByNamespace: {}, conditionExprs: [] }, mainNamespaces: [], gfxFiles: [] } },
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
				character: "ad421007ce66e7fb636be6297ece15d1f9b59979d887d1719c7e841aa379edd5",
				decision: "ef48119838111e002ba829c5434158bc188bf5329437fb2be1c06f8ff7f83c30",
				event: "645ea5311473a9ef81ded8881a0219d5de7842d6e5ffdabd625949c2655900ab",
				idea: "7bae1f5353b78ed41145a23689bd8d2514331b092bc16de681f02b149e098531",
				mio: "2870121f4b2774e43597d1b8d6c558f005f5926750bbcb110d6463f9e3a4eb07",
				technology: "cc32c8963c6fe8843265609b3a778fee9e00bda7fdb448fb8e1903cfbf119bad",
			});
		} finally {
			contextContainer.current = previous;
		}
	});
});
