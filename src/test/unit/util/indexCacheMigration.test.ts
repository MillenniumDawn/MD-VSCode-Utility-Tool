import * as assert from "assert";
import { __resetGfxIndexForTests, getGfxContainerFile } from "../../../util/gfxindex";
import { __resetIdeaSwapIndexForTests, getIdeaSwaps } from "../../../util/ideaSwapIndex";
import { __resetLocalisationIndexForTests, getLocalisedText } from "../../../util/localisationIndex";
import { __resetSharedFocusIndexForTests, findFileByFocusKey } from "../../../util/sharedFocusIndex";
import { listed, useIndexWorld } from "../indexes";

// Old manifests named unreadable files as fresh even when the corresponding data was absent.
// Exercise each real index's version boundary so a poisoned cache cannot survive an upgrade.
const cases = [
	{
		name: "gfxIndex", oldVersion: 4, root: "interface", file: "failed.gfx",
		content: 'spriteTypes = { spriteType = { name = "RECOVERED" texturefile = "x.dds" } }',
		reset: __resetGfxIndexForTests,
		lookup: () => getGfxContainerFile("RECOVERED"), expected: "interface/failed.gfx",
	},
	{
		name: "sharedFocusIndex", oldVersion: 2, root: "common/national_focus", file: "failed.txt",
		content: "shared_focus = { id = RECOVERED }",
		reset: __resetSharedFocusIndexForTests,
		lookup: () => findFileByFocusKey("RECOVERED"), expected: "common/national_focus/failed.txt",
	},
	{
		name: "localisationIndex", oldVersion: 2, root: "localisation", file: "failed_l_english.yml",
		content: 'l_english:\n RECOVERED:0 "restored access"',
		reset: __resetLocalisationIndexForTests,
		lookup: () => getLocalisedText("RECOVERED", "en"), expected: "restored access",
	},
	{
		name: "ideaSwapIndex", oldVersion: 2, root: "common", file: "failed.txt",
		content: "focus = { completion_reward = { swap_ideas = { remove_idea = a add_idea = b } } }",
		reset: __resetIdeaSwapIndexForTests,
		lookup: async () => (await getIdeaSwaps(["a"]))[0]?.file, expected: "common/failed.txt",
	},
];

for (const example of cases) {
	describe(`${example.name} failed-read cache migration`, () => {
		const world = useIndexWorld(example.reset, { [example.name]: true });
		it("retries a previously failed file marked fresh by the old cache version", async () => {
			world.useDisk();
			const path = `${example.root}/${example.file}`;
			world.list = (root, half) => root === example.root && half === "workspace" ? listed([example.file]) : [];
			world.read = () => Buffer.from(example.content);
			world.disk.set(world.cacheFile(`${example.name}.workspace.manifest.json`), Buffer.from(JSON.stringify({
				version: example.oldVersion, entries: [{ filePath: path, mtime: 1 }],
			})));
			world.disk.set(world.cacheFile(`${example.name}.workspace.data.jsonl`), Buffer.from("0\n"));
			assert.strictEqual(await example.lookup(), example.expected);
			assert.strictEqual(world.reads, 1);
			await world.drainCacheWrites();
			example.reset();
			assert.strictEqual(await example.lookup(), example.expected);
			assert.strictEqual(world.reads, 1, "the repaired cache should now be reusable");
		});
	});
}
