import * as assert from "assert";
import { refreshFeatureFlags } from "../../../util/featureflags";
import {
	getGfxContainerFile,
	getGfxIndexVersion,
	getIndexedGfxNames,
	__resetGfxIndexForTests,
	__testHandlers,
} from "../../../util/gfxindex";
import { deferred, settle } from "../async";
import { Half, listed, useIndexWorld, workspaceFile } from "../indexes";

// The lazy build and the event handlers every index shares are in indexWatchers.test.ts.

function sprites(...names: string[]): Buffer {
	const types = names.map((name) => `spriteType = { name = "${name}" texturefile = "x.dds" }`).join(" ");
	return Buffer.from(`spriteTypes = { ${types} }`);
}

describe("util/gfxindex", () => {
	const world = useIndexWorld(__resetGfxIndexForTests, { gfxIndex: true });

	describe("with one file in both the game and the workspace", () => {
		beforeEach(() => {
			world.list = () => listed(["sprite.gfx"]);
			world.read = () => sprites("GFX_my_sprite");
		});

		// Reading the names is how the technology preview finds out which countries ship their own
		// icons: it has to look at the whole namespace, not resolve a name it already knows.
		it("hands back the indexed sprite names, and nothing at all when the flag is off", async () => {
			assert.deepStrictEqual(await getIndexedGfxNames(), ["GFX_my_sprite"]);
			assert.strictEqual(world.listings, 2);

			world.settings = { gfxIndex: false };
			refreshFeatureFlags();
			assert.deepStrictEqual(await getIndexedGfxNames(), []);
		});

		// The acceptance test for the Cancel button: stopping a build must leave nothing usable behind,
		// so the next lookup does the whole thing again instead of reading a half-filled index.
		it("rebuilds from scratch after a cancelled build rather than serving a partial index", async () => {
			world.cancelled = true;
			// A lookup never throws at its caller, so a cancelled build simply finds nothing.
			assert.strictEqual(await getGfxContainerFile("GFX_my_sprite"), undefined);
			await settle();
			assert.strictEqual(world.listings, 2);

			world.cancelled = false;
			assert.strictEqual(await getGfxContainerFile("GFX_my_sprite"), "interface/sprite.gfx");
			assert.strictEqual(world.listings, 4);
		});

		// The sprite namespace has no file to stat, so a cache built from it -- the technology preview's
		// country list -- watches this counter instead. It has to move for every mutation, or that
		// cache serves what it read before the edit forever.
		describe("version counter", () => {
			it("moves when the index is built and stands still for a lookup", async () => {
				const before = getGfxIndexVersion();
				await getIndexedGfxNames();
				const afterBuild = getGfxIndexVersion();
				assert.ok(afterBuild > before, `expected the build to move the version, got ${before} -> ${afterBuild}`);

				await getIndexedGfxNames();
				assert.strictEqual(getGfxIndexVersion(), afterBuild);
			});

			// Both halves indexed the same file here, so the global copy of the name survives; what
			// this pins is that the workspace removal is announced at all.
			it("moves when a file's sprites are removed", async () => {
				await getIndexedGfxNames();
				const afterBuild = getGfxIndexVersion();

				__testHandlers.onDeleteFiles({ files: [workspaceFile("interface/sprite.gfx")] });
				await settle();
				assert.ok(getGfxIndexVersion() > afterBuild, "expected a delete to move the version");
			});

			it("moves when an edited file is re-indexed", async () => {
				await getIndexedGfxNames();
				const afterBuild = getGfxIndexVersion();

				world.read = () => sprites("GFX_my_other_sprite");
				__testHandlers.onCreateFiles({ files: [workspaceFile("interface/sprite.gfx")] });
				await settle();
				await settle();

				assert.ok(getGfxIndexVersion() > afterBuild, "expected a re-index to move the version");
				assert.ok((await getIndexedGfxNames()).includes("GFX_my_other_sprite"));
			});
		});
	});

	describe("owner-guarded removal with duplicate GFX names", () => {
		it("keeps the winner when the losing file is deleted", async () => {
			world.list = (_root, half) => (half === "workspace" ? listed(["a.gfx", "b.gfx"]) : []);
			world.read = () => sprites("GFX_dup");

			assert.strictEqual(await getGfxContainerFile("GFX_dup"), "interface/b.gfx");
			__testHandlers.onDeleteFiles({ files: [workspaceFile("interface/a.gfx")] });
			await settle();
			assert.strictEqual(await getGfxContainerFile("GFX_dup"), "interface/b.gfx");

			__testHandlers.onDeleteFiles({ files: [workspaceFile("interface/b.gfx")] });
			await settle();
			assert.strictEqual(await getGfxContainerFile("GFX_dup"), undefined);
		});
	});

	// The parent mods are a half of their own. Inside one half the last file parsed wins, so a
	// sprite the workspace redefines in a differently named .gfx than the parent's would resolve to
	// whichever of the two the four-wide parse queue finished last. Across halves the order is
	// fixed: workspace, parent, vanilla.
	describe("parent mods", () => {
		const files: Record<Half, Record<string, Buffer>> = {
			global: {},
			parent: {
				"interface/parent.gfx": sprites("GFX_shared", "GFX_parent_only"),
				"interface/override.gfx": sprites("GFX_override"),
			},
			workspace: {
				"interface/sub.gfx": sprites("GFX_shared", "GFX_sub_only"),
				"interface/override.gfx": sprites("GFX_override"),
			},
		};
		let listedHalves: Half[];
		let releaseParentReads: () => void;

		beforeEach(() => {
			world.settings = { gfxIndex: true, parentModPaths: ["D:/mods/parent"] };
			refreshFeatureFlags();
			listedHalves = [];
			const parentReads = deferred();
			releaseParentReads = () => parentReads.resolve();

			world.list = (_root, half) => {
				listedHalves.push(half);
				return listed(Object.keys(files[half]).map((file) => file.replace("interface/", "")));
			};
			world.read = async (relativePath, half) => {
				if (half === "parent") {
					// The parent half parses last, on purpose: the order must not matter.
					await parentReads.promise;
				}
				const content = files[half][relativePath];
				if (content === undefined) {
					throw new Error(`no ${half} file ${relativePath}`);
				}
				return content;
			};
		});

		it("lists the parents as a half of their own, and keeps them out of the workspace half", async () => {
			releaseParentReads();
			await getIndexedGfxNames();
			assert.deepStrictEqual(listedHalves.sort(), ["global", "parent", "workspace"]);
		});

		it("resolves a sprite both define to the workspace's file, even when the parent parsed last", async () => {
			const lookup = getGfxContainerFile("GFX_shared");
			await settle();
			releaseParentReads();

			assert.strictEqual(await lookup, "interface/sub.gfx");
			assert.strictEqual(await getGfxContainerFile("GFX_parent_only"), "interface/parent.gfx");
			assert.ok((await getIndexedGfxNames()).includes("GFX_parent_only"));
		});

		it("keeps the parent's copy when the workspace override of a file is deleted", async () => {
			releaseParentReads();
			assert.strictEqual(await getGfxContainerFile("GFX_override"), "interface/override.gfx");

			__testHandlers.onDeleteFiles({ files: [workspaceFile("interface/override.gfx")] });
			await settle();
			assert.strictEqual(await getGfxContainerFile("GFX_override"), "interface/override.gfx");

			// And a workspace-only file's sprites do go when it does.
			__testHandlers.onDeleteFiles({ files: [workspaceFile("interface/sub.gfx")] });
			await settle();
			assert.strictEqual(await getGfxContainerFile("GFX_sub_only"), undefined);
			assert.strictEqual(await getGfxContainerFile("GFX_shared"), "interface/parent.gfx");
		});

		it("rebuilds the parent half alone when the parent list changes", async () => {
			releaseParentReads();
			await getIndexedGfxNames();
			listedHalves = [];

			__testHandlers.onChangeParentMods({ folders: true, unresolved: false });
			await settle();
			await settle();
			assert.deepStrictEqual(listedHalves, ["parent"]);
		});

		it("rebuilds nothing when only the unresolved dependency names change", async () => {
			releaseParentReads();
			await getIndexedGfxNames();
			listedHalves = [];

			__testHandlers.onChangeParentMods({ folders: false, unresolved: true });
			await settle();
			await settle();
			assert.deepStrictEqual(listedHalves, []);
		});
	});
});
