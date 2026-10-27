import * as assert from "assert";
import { mock } from "node:test";
import { __resetGfxIndexForTests, getIndexedGfxNames } from "../../util/gfxindex";
import * as vsccommon from "../../util/vsccommon";
import { deferred } from "./async";
import { handOverLaterWorldEditorFor, listed, useIndexWorld } from "./indexes";

// Regression for the crossing the fire-and-forget disk cache write makes with the test boundary: a
// save that only settles once a later world holds the editor must not file its write into the later
// world's disk.

type WriteFile = typeof vsccommon.writeFile;
const realWriteFile: WriteFile = vsccommon.writeFile;

function gfx(): Buffer {
	return Buffer.from('spriteTypes = { spriteType = { name = "GFX_late" texturefile = "x.dds" } }');
}

describe("useIndexWorld", () => {
	const world = useIndexWorld(__resetGfxIndexForTests, { gfxIndex: true });

	beforeEach(() => {
		world.useDisk();
		world.list = (_root, half) => (half === "workspace" ? listed(["sprite.gfx"]) : []);
		world.read = () => gfx();
	});

	it("drops a save that settles after the handover instead of writing the later world's disk", async () => {
		// Holding the workspace read keeps the parse -- and with it the save that follows it -- from
		// running before the handover below, so the save's continuation meets a later world's editor.
		const started = deferred();
		const release = deferred();
		let lateWrites = 0;
		world.read = async () => {
			started.resolve();
			await release.promise;
			return gfx();
		};
		mock.method(vsccommon, "writeFile", (...args: Parameters<WriteFile>) => {
			lateWrites++;
			return realWriteFile(...args);
		});

		void getIndexedGfxNames();
		await started.promise;
		lateWrites = 0;

		// What the next test's beforeEach does: hand a fresh editor over a storage root of its own,
		// while this world's build is still in flight under its captured scope.
		const laterDisk = handOverLaterWorldEditorFor(world);

		release.resolve();
		const drained = await world.drainCacheWrites();
		assert.ok(drained > 0, "expected the build to ask for a cache save before the test ended");
		assert.ok(lateWrites > 0, "expected the save to have reached a disk write after the handover");
		// The write belongs to this world's root, so the later editor has nowhere to put it.
		assert.strictEqual(laterDisk.size, 0);
	});
});