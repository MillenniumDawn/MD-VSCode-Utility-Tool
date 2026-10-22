import * as assert from "assert";
import { mock } from "node:test";
import * as characterTraits from "../../../../util/characterTraits";
import * as gfxindex from "../../../../util/gfxindex";
import * as modifiers from "../../../../util/modifiers";
import { LoaderSession } from "../../../../util/loader/loader";
import { CharactersLoader } from "../../../../previewdef/character/loader";
import { handOver } from "../../host";

describe("previewdef/character/loader gfx dependencies", () => {
	const spriteFile = "interface/TST_portraits.gfx";
	const requested: string[][] = [];

	beforeEach(() => {
		requested.length = 0;
		handOver({ workspace: { getConfiguration: () => ({}) } });
		// Only the portrait the character names resolves, so a loader that never asks about it gets nothing.
		mock.method(gfxindex, "getGfxContainerFiles", async (names: (string | undefined)[]) => {
			requested.push(names.filter((name): name is string => name !== undefined));
			return names.includes("GFX_tst_portrait") ? [spriteFile] : [];
		});
		mock.method(modifiers, "loadModifierDefinitions", async () => ({}));
		mock.method(modifiers, "listModifierDefinitionFiles", async () => []);
		mock.method(characterTraits, "loadCharacterTraits", async () => ({ traits: {}, files: [] }));
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it("subscribes to the .gfx files its portrait sprites come from", async () => {
		const loader = new CharactersLoader("common/characters/TST.txt", async () =>
			"characters = { TST_someone = { portraits = { civilian = { large = GFX_tst_portrait } } } }",
		);
		const { result, dependencies } = await loader.load(new LoaderSession(false));

		assert.deepStrictEqual(requested, [["GFX_tst_portrait"]]);
		assert.deepStrictEqual(result.gfxFiles, [spriteFile]);
		assert.ok(dependencies.includes(spriteFile), `${spriteFile} is a dependency`);
	});
});
