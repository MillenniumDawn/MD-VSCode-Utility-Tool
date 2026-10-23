import * as assert from "assert";
import { refreshFeatureFlags } from "../../../util/featureflags";
import * as gfxindex from "../../../util/gfxindex";
import * as ideaSwapIndex from "../../../util/ideaSwapIndex";
import * as localisationIndex from "../../../util/localisationIndex";
import * as sharedFocusIndex from "../../../util/sharedFocusIndex";
import { deferred, settle } from "../async";
import { listed, useIndexWorld, workspaceFile } from "../indexes";

// The contract every index keeps with the editor: build nothing until something asks, build once
// however many ask at the same time, and hold an edit that arrives mid-build until the build has
// written what it read. Each index once had its own copy of these tests.

interface IndexCase {
	name: string;
	flag: string;
	reset(): void;
	register(): { dispose(): unknown };
	handlers: typeof gfxindex.__testHandlers;
	// The one file the workspace half lists, under its root.
	root: string;
	file: string;
	content: string;
	// One listing per root, for the global half and the workspace half.
	listingsPerBuild: number;
	lookup(): Promise<unknown>;
	// What the lookup answers once the file is indexed, and once it is gone.
	found: unknown;
	missing: unknown;
}

const cases: IndexCase[] = [
	{
		name: "gfx",
		flag: "gfxIndex",
		reset: gfxindex.__resetGfxIndexForTests,
		register: gfxindex.registerGfxIndex,
		handlers: gfxindex.__testHandlers,
		root: "interface",
		file: "sprite.gfx",
		content: 'spriteTypes = { spriteType = { name = "GFX_my_sprite" texturefile = "x.dds" } }',
		listingsPerBuild: 2,
		lookup: () => gfxindex.getGfxContainerFile("GFX_my_sprite"),
		found: "interface/sprite.gfx",
		missing: undefined,
	},
	{
		name: "shared focus",
		flag: "sharedFocusIndex",
		reset: sharedFocusIndex.__resetSharedFocusIndexForTests,
		register: sharedFocusIndex.registerSharedFocusIndex,
		handlers: sharedFocusIndex.__testHandlers,
		root: "common/national_focus",
		file: "shared.txt",
		content: "shared_focus = { id = my_shared_focus }",
		listingsPerBuild: 2,
		lookup: () => sharedFocusIndex.findFileByFocusKey("my_shared_focus"),
		found: "common/national_focus/shared.txt",
		missing: undefined,
	},
	{
		name: "localisation",
		flag: "localisationIndex",
		reset: localisationIndex.__resetLocalisationIndexForTests,
		register: localisationIndex.registerLocalisationIndex,
		handlers: localisationIndex.__testHandlers,
		root: "localisation",
		file: "test_l_english.yml",
		content: 'l_english:\n KEY_A:0 "Value A"\n',
		listingsPerBuild: 2,
		lookup: () => localisationIndex.getLocalisedText("KEY_A", "en"),
		found: "Value A",
		missing: "KEY_A",
	},
	{
		name: "idea swap",
		flag: "ideaSwapIndex",
		reset: ideaSwapIndex.__resetIdeaSwapIndexForTests,
		register: ideaSwapIndex.registerIdeaSwapIndex,
		handlers: ideaSwapIndex.__testHandlers,
		root: "common",
		file: "swaps.txt",
		content: "focus = { completion_reward = { swap_ideas = { remove_idea = a add_idea = b } } }",
		// Two roots, common and events.
		listingsPerBuild: 4,
		lookup: async () => (await ideaSwapIndex.getIdeaSwaps(["a"])).map((swap) => swap.file),
		found: ["common/swaps.txt"],
		missing: [],
	},
];

for (const index of cases) {
	describe(`the ${index.name} index, kept in step with the editor`, () => {
		const world = useIndexWorld(index.reset, { [index.flag]: true });
		const path = `${index.root}/${index.file}`;
		const deleteFile = () => index.handlers.onDeleteFiles({ files: [workspaceFile(path)] });

		// Only the workspace half lists the file, so a lookup that falls back to vanilla cannot
		// mask a change to the workspace half.
		beforeEach(() => {
			world.list = (root, half) => (half === "workspace" && root === index.root ? listed([index.file]) : []);
			world.read = () => Buffer.from(index.content);
		});

		it("registers a disposable and does no build work for it", async () => {
			const disposable = index.register();
			await settle();
			assert.strictEqual(world.listings, 0);
			assert.strictEqual(typeof disposable.dispose, "function");
			disposable.dispose();
		});

		it("does no build work when the feature flag is off", async () => {
			world.settings = { [index.flag]: false };
			refreshFeatureFlags();
			assert.deepStrictEqual(await index.lookup(), index.missing);
			assert.strictEqual(world.listings, 0);
		});

		it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async () => {
			const [first, second] = await Promise.all([index.lookup(), index.lookup()]);
			assert.deepStrictEqual([first, second], [index.found, index.found]);
			assert.strictEqual(world.listings, index.listingsPerBuild);

			assert.deepStrictEqual(await index.lookup(), index.found);
			assert.strictEqual(world.listings, index.listingsPerBuild);
		});

		it("ignores incremental events that arrive before any build has started", async () => {
			deleteFile();
			index.handlers.onCreateFiles({ files: [workspaceFile(path)] });
			await settle();
			assert.strictEqual(world.listings, 0);

			assert.deepStrictEqual(await index.lookup(), index.found);
		});

		// If the delete ran at once it would be a no-op against the still-empty index, and the build's
		// later write would bring the entry back. Deferred, it runs after that write and removes it.
		it("defers an event that arrives while the build is pending, and applies it once the build settles", async () => {
			const read = deferred<Buffer>();
			world.read = () => read.promise;
			const lookup = index.lookup();
			await settle();

			deleteFile();
			read.resolve(Buffer.from(index.content));
			await lookup;
			await settle();

			assert.deepStrictEqual(await index.lookup(), index.missing);
		});

		it("applies an event immediately once the build has already settled", async () => {
			assert.deepStrictEqual(await index.lookup(), index.found);
			deleteFile();
			assert.deepStrictEqual(await index.lookup(), index.missing);
		});
	});
}
