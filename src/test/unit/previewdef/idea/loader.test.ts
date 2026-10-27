import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../util/fileloader";
import * as gfxindex from "../../../../util/gfxindex";
import * as modifiers from "../../../../util/modifiers";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { LoaderSession } from "../../../../util/loader/loader";
import { IdeasLoader } from "../../../../previewdef/idea/loader";
import { handOver } from "../../host";

describe("previewdef/idea/loader gfx dependencies", () => {
	const spriteFile = "interface/TST_ideas.gfx";
	const requested: string[][] = [];

	beforeEach(() => {
		requested.length = 0;
		handOver({ workspace: { getConfiguration: () => ({}) } });
		refreshFeatureFlags();
		// Only the sprite the idea names resolves, so a loader that never asks about it gets nothing.
		mock.method(gfxindex, "getGfxContainerFiles", async (names: (string | undefined)[]) => {
			requested.push(names.filter((name): name is string => name !== undefined));
			return names.includes("GFX_idea_tst_pic") ? [spriteFile] : [];
		});
		mock.method(modifiers, "loadModifierDefinitions", async () => ({}));
		mock.method(modifiers, "listModifierDefinitionFiles", async () => []);
		mock.method(fileloader, "getDescriptorIdeaPlaceholderIcon", async () => []);
		mock.method(fileloader, "getFilePathFromModOrHOI4", async () => undefined);
	});

	afterEach(() => {
		mock.restoreAll();
		refreshFeatureFlags();
	});

	it("subscribes to the .gfx files its sprites come from", async () => {
		const loader = new IdeasLoader("common/ideas/TST.txt", async () =>
			"ideas = { country = { TST_idea = { picture = tst_pic } } }",
		);
		const { result, dependencies } = await loader.load(new LoaderSession(false));

		assert.deepStrictEqual(requested, [["GFX_idea_tst_pic"]]);
		for (const gfx of [spriteFile, "interface/ideas.gfx"]) {
			assert.ok(result.gfxFiles.includes(gfx), `${gfx} is drawn from`);
			assert.ok(dependencies.includes(gfx), `${gfx} is a dependency`);
		}
	});
});
