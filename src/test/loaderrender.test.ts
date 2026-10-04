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
				bop: "61ccdcddc6268847ad6544915643d2c1f3cb2f705cb3a56968603747d5537a20",
				character: "dcdc496d41c97b51971da6aa5075c88935b648e5572eff21119d8363bf21fb50",
				decision: "4ac0d726aa48af74dbedfbfb480eff6dc04c147108edce91789544a2e97e45d2",
				event: "033e4e77ffbd288ffe918b8e34525530ced87443b1ce1ea6ddeffc14489f39a0",
				idea: "f02eaa8998ff4a286508c199b2b87ac30b837ca8b7d3712b363572f12fcf580c",
				mio: "6cc31aa85b6d2c42f7de90b85b60304d096a3ef6f413e006abbb64c53d0b64ed",
				technology: "fe8d2cc647532bb67abed467fd3866548a7de7497cbe1654499408c3b48e56a6",
			});
		} finally {
			contextContainer.current = previous;
		}
	});
});
