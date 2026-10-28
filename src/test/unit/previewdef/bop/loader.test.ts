import * as assert from "assert";
import { mock } from "node:test";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import { BopLoader } from "../../../../previewdef/bop/loader";
import * as decisions from "../../../../previewdef/bop/decisions";
import * as decisionLoader from "../../../../previewdef/decision/loader";
import * as fileloader from "../../../../util/fileloader";
import * as gfxindex from "../../../../util/gfxindex";
import * as guiwindowindex from "../../../../util/guiwindowindex";
import { LoaderSession } from "../../../../util/loader/loader";
import { handOver } from "../../host";

const file = "common/bop/SOV.txt";
const gui = `guiTypes = {
	iconType = { name = range_bar spriteType = GFX_bop_splitter }
	iconType = { name = range_indicator spriteType = GFX_bop_indicator }
}`;

function window(extra: Record<string, unknown> = {}) {
	return {
		background: { spritetype: "GFX_bg", quadtexturesprite: "GFX_bg_quad" },
		icontype: [{ spritetype: "GFX_icon", quadtexturesprite: "GFX_icon_quad" }],
		buttontype: [{ spritetype: "GFX_btn", quadtexturesprite: "GFX_btn_quad" }],
		checkboxtype: [],
		guibuttontype: [],
		containerwindowtype: [],
		windowtype: [],
		...extra,
	};
}

describe("previewdef/bop/loader", () => {
	beforeEach(() => {
		handOver({
			workspace: { getConfiguration: () => ({}) },
			window: { createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }) },
		});
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it("reads the window, both side icons, the category's decisions and the range templates", async () => {
		const asked: string[][] = [];
		mock.method(guiwindowindex, "findContainerWindows", async () => ({
			powerbalanceview: {
				file: "interface/powerbalanceview.gui",
				window: window({
					windowtype: [window({ icontype: [{ spritetype: "GFX_nested" }] })],
				}),
			},
			decision_item: {
				file: "interface/countrydecisionview.gui",
				window: window(),
			},
		}));
		mock.method(decisions, "loadCategoryDecisions", async () => ({
			ROM: [{ icons: [{ key: "flag" }] }],
		}));
		mock.method(decisionLoader, "getDecisionGfxFiles", async () => ["interface/decisions.gfx"]);
		mock.method(gfxindex, "getGfxContainerFiles", async (names: string[]) => {
			asked.push(names);
			return ["interface/side.gfx"];
		});
		mock.method(fileloader, "parseAndResolveHoi4FileCached", async () => parseHoi4File(gui));

		const loader = new BopLoader(file, async () => `
			SOV_balance = {
				initial_value = 0
				decision_category = ROM
				side = { id = left icon = GFX_left }
				side = { id = right icon = GFX_right }
			}
		`);
		const result = await loader.load(new LoaderSession(true));

		assert.strictEqual(loader.toString(), `[BopLoader ${file}]`);
		assert.strictEqual(result.result.bops.bops[0]?.decisionCategory, "ROM");
		assert.strictEqual(result.result.window?.file, "interface/powerbalanceview.gui");
		assert.strictEqual(result.result.decisionItem?.file, "interface/countrydecisionview.gui");
		assert.strictEqual(result.result.templates.rangeBar?.spritetype, "GFX_bop_splitter");
		assert.strictEqual(result.result.templates.rangeIndicator?.spritetype, "GFX_bop_indicator");
		assert.deepStrictEqual(result.result.decisions.ROM?.map((d) => d.icons[0]?.key), ["flag"]);
		assert.ok(asked[0]?.includes("GFX_left"), asked[0]?.join(","));
		assert.ok(asked[0]?.includes("GFX_nested"), "a nested window's sprite was not asked for");
		for (const dependency of [
			file,
			"interface/powerbalanceview.gui",
			"interface/countrydecisionview.gui",
			"common/decisions/*",
			"interface/side.gfx",
			"interface/decisions.gfx",
			"interface/powerbalanceview.gfx",
		]) {
			assert.ok(result.dependencies.includes(dependency), dependency);
		}
	});

	it("keeps the balance when the range templates cannot be read", async () => {
		mock.method(guiwindowindex, "findContainerWindows", async () => ({
			powerbalanceview: { file: "interface/powerbalanceview.gui", window: window() },
		}));
		mock.method(gfxindex, "getGfxContainerFiles", async () => []);
		mock.method(fileloader, "parseAndResolveHoi4FileCached", async () => {
			throw new Error("gui boom");
		});

		const loader = new BopLoader(file, async () => "SOV_balance = { initial_value = 0 }");
		const result = await loader.load(new LoaderSession(true));

		assert.deepStrictEqual(result.result.templates, {});
		assert.strictEqual(result.result.decisionItem, undefined);
		assert.ok(!result.dependencies.includes("common/decisions/*"));
	});
});
