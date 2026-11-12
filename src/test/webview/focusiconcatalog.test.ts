import { takePostedMessages, loadEntrypoint, useEntrypoint, resetWebviewState } from "./setup";
import * as assert from "assert";

// The ids the host's page shell gives the catalog's controls (renderCatalogHtml).
const body = `
<input id="catalog-search" type="search"/>
<select id="catalog-source"><option value="all">All</option><option value="mod">Mod</option><option value="parent">Parent</option><option value="vanilla">Vanilla</option></select>
<select id="catalog-file"><option value="">All files</option></select>
<input id="catalog-shine" type="checkbox" checked/>
<span id="catalog-count"></span>
<button id="refresh"></button>
<div id="catalog-status"></div>
<div id="catalog-grid"></div>
<div id="catalog-toast"></div>`;

const observed: Element[] = [];
class FakeIntersectionObserver {
	constructor(private readonly callback: (entries: { isIntersecting: boolean; target: Element }[]) => void) {}
	observe(target: Element) { observed.push(target); }
	unobserve() {}
	disconnect() { observed.length = 0; }
	// Brings every observed tile into view.
	show() { this.callback(observed.map(target => ({ isIntersecting: true, target }))); }
}
let lastObserver: FakeIntersectionObserver | undefined;
// What the page posted while it loaded, before the first test empties the log.
let loadPosts: any[] = [];

const catalog = {
	icons: [
		{ name: "GFX_focus_generic_industry_1", gfxFile: "interface/goals.gfx", texture: "gfx/interface/goals/industry.dds", source: "vanilla", shine: false },
		{ name: "GFX_focus_generic_industry_1_shine", gfxFile: "interface/goals_shine.gfx", texture: "gfx/interface/goals/industry.dds", source: "vanilla", shine: true },
		{ name: "GFX_MD_focus_ROM_army", gfxFile: "interface/MD_goals.gfx", texture: "gfx/interface/goals/ROM/army.dds", source: "mod", shine: false },
	],
	gfxFiles: [
		{ path: "interface/MD_goals.gfx", source: "mod", count: 1 },
		{ path: "interface/goals.gfx", source: "vanilla", count: 1 },
	],
};

const { listeners } = loadEntrypoint(() => require("../../../webviewsrc/focusiconcatalog"));

function tile(name: string): HTMLElement {
	return document.querySelector(`.catalog-tile[data-name="${name}"]`) as HTMLElement;
}

describe("webviewsrc/focusiconcatalog", () => {
	useEntrypoint(listeners);

	before(() => {
		(globalThis as any).IntersectionObserver = class extends FakeIntersectionObserver {
			constructor(callback: any) {
				super(callback);
				lastObserver = this;
			}
		};
		resetWebviewState();
		document.body.innerHTML = body;
		window.dispatchEvent(new Event("load"));
		loadPosts = takePostedMessages();
		window.dispatchEvent(new MessageEvent("message", { data: { type: "catalog", data: catalog } }));
	});

	after(() => {
		delete (globalThis as any).IntersectionObserver;
	});

	it("asks for the icons once the page has loaded", () => {
		assert.deepStrictEqual(loadPosts, [{ command: "ready" }]);
	});

	it("draws a tile per icon and hides shine sprites by default", () => {
		assert.strictEqual(document.querySelectorAll(".catalog-tile").length, 3);
		assert.strictEqual(tile("GFX_focus_generic_industry_1_shine").hidden, true);
		assert.strictEqual(tile("GFX_MD_focus_ROM_army").hidden, false);
		assert.strictEqual(document.getElementById("catalog-count")!.textContent, "2 of 3 icons");
	});

	it("copies a clicked icon's name through the host", () => {
		takePostedMessages();
		tile("GFX_MD_focus_ROM_army").dispatchEvent(new MouseEvent("click", { bubbles: true }));
		assert.deepStrictEqual(takePostedMessages(), [{ command: "copyName", name: "GFX_MD_focus_ROM_army" }]);
		assert.ok(document.getElementById("catalog-toast")!.textContent!.includes("GFX_MD_focus_ROM_army"));
	});

	it("opens the definition on ctrl+click instead of copying", () => {
		takePostedMessages();
		tile("GFX_focus_generic_industry_1").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
		assert.deepStrictEqual(takePostedMessages(), [{ command: "openDefinition", name: "GFX_focus_generic_industry_1" }]);
	});

	it("filters by search text, source and file", () => {
		const search = document.getElementById("catalog-search") as HTMLInputElement;
		search.value = "rom_army";
		search.dispatchEvent(new Event("input"));
		assert.strictEqual(tile("GFX_focus_generic_industry_1").hidden, true);
		assert.strictEqual(tile("GFX_MD_focus_ROM_army").hidden, false);
		search.value = "";
		search.dispatchEvent(new Event("input"));

		const source = document.getElementById("catalog-source") as HTMLSelectElement;
		source.value = "vanilla";
		source.dispatchEvent(new Event("change"));
		assert.strictEqual(tile("GFX_MD_focus_ROM_army").hidden, true);
		assert.strictEqual(tile("GFX_focus_generic_industry_1").hidden, false);
		source.value = "all";
		source.dispatchEvent(new Event("change"));

		const file = document.getElementById("catalog-file") as HTMLSelectElement;
		assert.deepStrictEqual([...file.options].map(o => o.value), ["", "interface/MD_goals.gfx", "interface/goals.gfx"]);
		file.value = "interface/MD_goals.gfx";
		file.dispatchEvent(new Event("change"));
		assert.strictEqual(tile("GFX_focus_generic_industry_1").hidden, true);
		file.value = "";
		file.dispatchEvent(new Event("change"));
	});

	it("asks for the pictures of tiles in view and draws what comes back", async () => {
		takePostedMessages();
		lastObserver!.show();
		await new Promise(resolve => setTimeout(resolve, 60));
		const requests = takePostedMessages().filter(m => m.command === "requestImages");
		assert.strictEqual(requests.length, 1);
		assert.strictEqual(requests[0].names.length, 3);

		window.dispatchEvent(new MessageEvent("message", { data: { type: "images", images: {
			GFX_MD_focus_ROM_army: "data:image/png;base64,AAAA",
			GFX_focus_generic_industry_1: null,
		} } }));
		assert.strictEqual(tile("GFX_MD_focus_ROM_army").querySelector("img")!.getAttribute("src"), "data:image/png;base64,AAAA");
		assert.ok(tile("GFX_focus_generic_industry_1").querySelector(".catalog-image")!.classList.contains("missing"));
	});

	it("asks the host to reload on refresh", () => {
		takePostedMessages();
		document.getElementById("refresh")!.dispatchEvent(new MouseEvent("click"));
		assert.deepStrictEqual(takePostedMessages(), [{ command: "reload" }]);
	});
});
