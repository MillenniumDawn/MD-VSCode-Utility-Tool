import * as assert from "assert";
import { mock } from "node:test";
import * as gfxindex from "../../../../util/gfxindex";
import { LoaderSession } from "../../../../util/loader/loader";
import { EventsLoader } from "../../../../previewdef/event/loader";
import { handOver } from "../../host";

describe("previewdef/event/loader gfx dependencies", () => {
	const spriteFile = "interface/TST_eventpictures.gfx";
	const requested: string[][] = [];

	beforeEach(() => {
		requested.length = 0;
		handOver({ workspace: { getConfiguration: () => ({}) } });
		// Only the picture the event names resolves, so a loader that never asks about it gets nothing.
		mock.method(gfxindex, "getGfxContainerFiles", async (names: (string | undefined)[]) => {
			requested.push(names.filter((name): name is string => name !== undefined));
			return names.includes("GFX_tst_pic") ? [spriteFile] : [];
		});
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it("subscribes to the .gfx files its pictures come from", async () => {
		const loader = new EventsLoader("events/TST.txt", async () =>
			"add_namespace = tst\ncountry_event = { id = tst.1 picture = GFX_tst_pic }\n",
		);
		const { result, dependencies } = await loader.load(new LoaderSession(false));

		assert.deepStrictEqual(requested, [["GFX_tst_pic"]]);
		for (const gfx of [spriteFile, "interface/eventpictures.gfx"]) {
			assert.ok(result.gfxFiles.includes(gfx), `${gfx} is drawn from`);
			assert.ok(dependencies.includes(gfx), `${gfx} is a dependency`);
		}
	});
});
