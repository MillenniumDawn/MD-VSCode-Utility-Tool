import * as assert from "assert";
import { mock } from "node:test";
import { getGfxContainerFile, __resetGfxIndexForTests, __testHandlers as gfxHandlers } from "../../../util/gfxindex";
import { getLocalisedText, __resetLocalisationIndexForTests, __testHandlers as locHandlers } from "../../../util/localisationIndex";
import { deferred, settle } from "../async";
import { Half, listed, useIndexWorld, workspaceFile } from "../indexes";

for (const kind of ["gfx", "localisation"] as const) {
	describe(`${kind} deterministic file precedence`, () => {
		const gfx = kind === "gfx";
		const reset = gfx ? __resetGfxIndexForTests : __resetLocalisationIndexForTests;
		const handlers = gfx ? gfxHandlers : locHandlers;
		const world = useIndexWorld(reset, { [gfx ? "gfxIndex" : "localisationIndex"]: true });
		const root = gfx ? "interface" : "localisation";
		const names = gfx ? ["a.gfx", "z.gfx"] : ["a_l_english.yml", "z_l_english.yml"];
		const key = gfx ? "GFX_duplicate" : "DUPLICATE";
		const lookup = () => gfx ? getGfxContainerFile(key) : getLocalisedText(key, "en");
		const winner = `${root}/${names[1]}`;
		const expected = gfx ? winner : "z";
		const content = (value: string, entryKey = key) => Buffer.from(gfx
			? `spriteTypes = { spriteType = { name = ${entryKey} texturefile = x.dds } }`
			: `l_english:\n ${entryKey}:0 "${value}"`);

		for (const half of ["workspace", "parent", "global"] as Half[]) {
			for (const slow of ["a", "z"]) {
				it(`${half}: keeps the same cold and warm winner when ${slow} finishes last`, async () => {
					world.useDisk();
					if (half === "parent") {
						world.settings.parentModPaths = ["D:/mods/parent"];
					}
					world.list = (_root, source) => source === half ? listed([...names].reverse()) : [];
					const release = deferred();
					const bothReading = deferred();
					let started = 0;
					world.read = async file => {
						if (++started === 2) { bothReading.resolve(); }
						const id = file.slice(file.lastIndexOf("/") + 1, file.lastIndexOf("/") + 2);
						if (id === slow) { await release.promise; }
						return content(id);
					};
					const building = lookup();
					// Neither read can wait for the other to finish: parsing stays concurrent.
					await bothReading.promise;
					await settle();
					release.resolve();
					assert.strictEqual(await building, expected);
					await world.drainCacheWrites();
					// Hydration must not depend on record order either.
					for (const [path, bytes] of world.disk) {
						if (path.endsWith(".data.jsonl")) {
							const records = Buffer.from(bytes).toString().trim().split("\n");
							const count = records.pop();
							world.disk.set(path, Buffer.from([...records.reverse(), count].join("\n") + "\n"));
						}
					}
					const reads = world.reads;
					reset();
					assert.strictEqual(await lookup(), expected);
					assert.strictEqual(world.reads, reads, "warm build uses cached contributions");
				});
			}
		}

		afterEach(() => mock.timers.reset());

		async function flushFileEvents(): Promise<void> {
			// Also supports coalesced watcher implementations: let the trailing debounce fire,
			// then drain the parse promises before inspecting the winner.
			mock.timers.tick(1000);
			await settle();
			await settle();
		}

		beforeEach(() => {
			world.list = (_root, half) => half === "workspace" ? listed(names) : [];
			world.read = file => content(file.includes(`/${names[0]}`) ? "a" : "z");
		});

		it("keeps a higher-priority winner after a lower-priority file is edited, including after warm reload", async () => {
			world.useDisk();
			assert.strictEqual(await lookup(), expected);
			await world.drainCacheWrites();
			reset();
			assert.strictEqual(await lookup(), expected);
			mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
			handlers.onDeleteFiles({ files: [workspaceFile(winner)] });
			await flushFileEvents();
			assert.strictEqual(await lookup(), gfx ? `${root}/${names[0]}` : "a", "warm cache retains the shadowed file's actual value");
			handlers.onCreateFiles({ files: [workspaceFile(winner)] });
			await flushFileEvents();
			assert.strictEqual(await lookup(), expected);
			world.read = () => content("edited a");
			handlers.onCreateFiles({ files: [workspaceFile(`${root}/${names[0]}`)] });
			await flushFileEvents();
			assert.strictEqual(await lookup(), expected);
			// The updated lower file also remains available when the winner disappears.
			handlers.onDeleteFiles({ files: [workspaceFile(winner)] });
			await flushFileEvents();
			assert.strictEqual(await lookup(), gfx ? `${root}/${names[0]}` : "edited a");
		});

		for (const warm of [false, true]) {
			async function prepareDuplicate(): Promise<void> {
				if (warm) { world.useDisk(); }
				assert.strictEqual(await lookup(), expected);
				if (warm) {
					await world.drainCacheWrites();
					const reads = world.reads;
					reset();
					assert.strictEqual(await lookup(), expected);
					assert.strictEqual(world.reads, reads);
				}
				mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
			}

			it(`${warm ? "warm" : "cold"}: restores the surviving definition when the winner is edited away`, async () => {
				await prepareDuplicate();
				world.read = file => file === winner ? content("replacement", "OTHER_KEY") : content("a");
				handlers.onCreateFiles({ files: [workspaceFile(winner)] });
				await flushFileEvents();
				assert.strictEqual(await lookup(), gfx ? `${root}/${names[0]}` : "a");
			});

			it(`${warm ? "warm" : "cold"}: leaves the winning definition intact when the loser is deleted`, async () => {
				await prepareDuplicate();
				handlers.onDeleteFiles({ files: [workspaceFile(`${root}/${names[0]}`)] });
				await flushFileEvents();
				assert.strictEqual(await lookup(), expected);
			});
		}

		it("preserves precedence when a stale lower-priority file is parsed beside fresh cached records", async () => {
			world.useDisk();
			assert.strictEqual(await lookup(), expected);
			await world.drainCacheWrites();
			world.list = (_root, half) => half === "workspace" ? listed(names).map((file, i) => ({ ...file, mtime: i === 0 ? 2 : 1 })) : [];
			world.read = file => content(file.includes(`/${names[0]}`) ? "changed a" : "z");
			reset();
			assert.strictEqual(await lookup(), expected);
		});

		for (const oldVersion of (gfx ? [4, 5] : [2, 3])) {
			it(`rejects winner-only cache version ${oldVersion} and rereads the sources`, async () => {
				world.useDisk();
				assert.strictEqual(await lookup(), expected);
				await world.drainCacheWrites();
				for (const [path, bytes] of world.disk) {
					if (path.endsWith(".manifest.json")) {
						const manifest = JSON.parse(Buffer.from(bytes).toString());
						manifest.version = oldVersion;
						world.disk.set(path, Buffer.from(JSON.stringify(manifest)));
					}
				}
				const reads = world.reads;
				reset();
				assert.strictEqual(await lookup(), expected);
				assert.strictEqual(world.reads - reads, 2);
			});
		}
	});
}
