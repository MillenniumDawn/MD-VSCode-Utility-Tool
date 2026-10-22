import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../util/fileloader";
import * as gfxindex from "../../../../util/gfxindex";
import * as guiwindowindex from "../../../../util/guiwindowindex";
import * as modifiers from "../../../../util/modifiers";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { LoaderSession } from "../../../../util/loader/loader";
import { DecisionsLoader, vanillaDecisionsGfxFile } from "../../../../previewdef/decision/loader";
import { handOver } from "../../host";

describe("previewdef/decision/loader gfx dependencies", () => {
	const spriteFile = "interface/TST_decisions.gfx";
	const requested: string[][] = [];

	beforeEach(() => {
		requested.length = 0;
		handOver({ workspace: { getConfiguration: () => ({}) } });
		refreshFeatureFlags();
		// Only the sprite the decision names resolves, so a loader that never asks about it gets nothing.
		mock.method(gfxindex, "getGfxContainerFiles", async (names: (string | undefined)[]) => {
			requested.push(names.filter((name): name is string => name !== undefined));
			return names.includes("GFX_decision_tst_icon") ? [spriteFile] : [];
		});
		mock.method(modifiers, "loadModifierDefinitions", async () => ({}));
		mock.method(modifiers, "listModifierDefinitionFiles", async () => []);
		mock.method(guiwindowindex, "findContainerWindows", async () => ({}));
		mock.method(fileloader, "getDescriptorDecisionGfx", async () => []);
		mock.method(fileloader, "getFilePathFromModOrHOI4", async (path: string) =>
			path === vanillaDecisionsGfxFile ? path : undefined,
		);
	});

	afterEach(() => {
		mock.restoreAll();
		refreshFeatureFlags();
	});

	it("subscribes to the .gfx files its sprites come from", async () => {
		const loader = new DecisionsLoader("common/decisions/TST.txt", async () =>
			"TST_category = { TST_decision = { icon = tst_icon } }",
		);
		// The category and scripted GUI folders are read through loaders of their own.
		const noDefinitions = { load: async () => ({ result: [], dependencies: [] }) };
		Object.assign(loader, { categoriesLoader: noDefinitions, scriptedGuisLoader: noDefinitions });
		const { result, dependencies } = await loader.load(new LoaderSession(false));

		assert.deepStrictEqual(requested, [["GFX_decision_tst_icon"]]);
		for (const gfx of [spriteFile, vanillaDecisionsGfxFile]) {
			assert.ok(result.gfxFiles.includes(gfx), `${gfx} is drawn from`);
			assert.ok(dependencies.includes(gfx), `${gfx} is a dependency`);
		}
	});
});
