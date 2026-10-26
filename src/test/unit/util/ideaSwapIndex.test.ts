import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import * as hoiparser from "../../../hoiformat/hoiparser";
import { refreshFeatureFlags } from "../../../util/featureflags";
import {
	extractIdeaSwaps,
	__resetIdeaSwapIndexForTests,
	__testHandlers,
	getIdeaSwaps,
	registerIdeaSwapIndex,
} from "../../../util/ideaSwapIndex";
import { Logger } from "../../../util/logger";
import { settle } from "../async";
import { listed, useIndexWorld, workspaceFile } from "../indexes";

const SWAP_FILE = "common/national_focus/swaps.txt";
const swap = Buffer.from("focus = { completion_reward = { swap_ideas = { remove_idea = a add_idea = b } } }");

async function swapFiles(): Promise<string[]> {
	return (await getIdeaSwaps(["a"])).map((found) => found.file);
}

// The swaps below are transcribed from Millennium Dawn's common/national_focus/00_generic.txt,
// where the political_power_bonus chain is performed.
describe("util/ideaSwapIndex extraction", () => {
	function swapsOf(input: string) {
		return extractIdeaSwaps(hoiparser.parseHoi4File(input));
	}

	it("finds a swap however deeply it is nested", () => {
		const swaps = swapsOf(`
            focus_tree = {
                focus = {
                    id = GENERIC_political_games
                    completion_reward = {
                        swap_ideas = {
                            remove_idea = political_power_bonus
                            add_idea = political_power_bonus2
                        }
                    }
                }
            }
        `);
		assert.deepStrictEqual(swaps.map((s) => [s.from, s.to]), [["political_power_bonus", "political_power_bonus2"]]);
	});

	it("records where the swap was written so a chain arrow can jump to it", () => {
		const source = "completion_reward = { swap_ideas = { remove_idea = a add_idea = b } }";
		const swap = swapsOf(source)[0];
		assert.ok(swap);
		assert.strictEqual(source.slice(swap!.start, swap!.start + "swap_ideas".length), "swap_ideas");
		assert.ok(swap!.end > swap!.start);
	});

	// The game pairs several removes with several adds in the order they are written.
	it("pairs matching counts in order", () => {
		const swaps = swapsOf(`
            swap_ideas = {
                remove_idea = a1
                remove_idea = a2
                add_idea = b1
                add_idea = b2
            }
        `);
		assert.deepStrictEqual(swaps.map((s) => [s.from, s.to]), [["a1", "b1"], ["a2", "b2"]]);
	});

	// Mismatched counts have no obvious pairing, so every combination is kept rather than the
	// extras being dropped.
	it("keeps every combination when the counts do not match", () => {
		const swaps = swapsOf(`
            swap_ideas = { remove_idea = a1 add_idea = b1 add_idea = b2 }
        `);
		assert.deepStrictEqual(swaps.map((s) => [s.from, s.to]), [["a1", "b1"], ["a1", "b2"]]);
	});

	it("ignores a block that names only one side, or names the same idea twice", () => {
		assert.deepStrictEqual(swapsOf("swap_ideas = { remove_idea = a }"), []);
		assert.deepStrictEqual(swapsOf("swap_ideas = { add_idea = b }"), []);
		assert.deepStrictEqual(swapsOf("swap_ideas = { remove_idea = a add_idea = a }"), []);
	});

	it("finds nothing in a file that performs no swap", () => {
		assert.deepStrictEqual(swapsOf("focus = { completion_reward = { add_idea = political_power_bonus } }"), []);
	});
});

describe("util/ideaSwapIndex", () => {
	const world = useIndexWorld(__resetIdeaSwapIndexForTests, { ideaSwapIndex: true });

	beforeEach(() => {
		world.list = (root, half) => (half === "workspace" && root === "common" ? listed(["national_focus/swaps.txt"]) : []);
		world.read = () => swap;
	});

	describe("registration", () => {
		it("returns a disposable", () => {
			world.settings = { ideaSwapIndex: false };
			refreshFeatureFlags();
			const disposable = registerIdeaSwapIndex();
			assert.ok(disposable);
			assert.strictEqual(typeof disposable.dispose, "function");
			disposable.dispose();
		});
	});

	describe("lookup", () => {
		let readFiles: string[];

		function stubFiles(files: Record<string, Buffer>): void {
			world.list = (root, half) => half === "workspace"
				? listed(Object.keys(files).filter(file => file.startsWith(root + "/")).map(file => file.slice(root.length + 1)))
				: [];
			world.read = relativePath => {
				readFiles.push(relativePath);
				const content = files[relativePath];
				if (!content) {
					throw new Error("no such file " + relativePath);
				}
				return content;
			};
		}

		beforeEach(() => {
			readFiles = [];
			stubFiles({
				"common/national_focus/00_generic.txt": Buffer.from(
					"focus = { completion_reward = { swap_ideas = { remove_idea = political_power_bonus add_idea = political_power_bonus2 } } }",
				),
				"common/national_focus/plain.txt": Buffer.from("focus = { completion_reward = { add_idea = something } }"),
			});
		});

		it("does no work at all when the setting is off", async () => {
			world.settings = { ideaSwapIndex: false };
			refreshFeatureFlags();
			assert.deepStrictEqual(await getIdeaSwaps(["political_power_bonus"]), []);
			assert.deepStrictEqual(readFiles, []);
		});

		it("does no work for an empty seed", async () => {
			assert.deepStrictEqual(await getIdeaSwaps([]), []);
			assert.deepStrictEqual(readFiles, []);
		});

		it("finds the swap an idea takes part in", async () => {
			const swaps = await getIdeaSwaps(["political_power_bonus"]);
			assert.deepStrictEqual(swaps.map(s => [s.from, s.to, s.file]), [
				["political_power_bonus", "political_power_bonus2", "common/national_focus/00_generic.txt"],
			]);
		});

		it("finds the same swap from the idea it swaps into", async () => {
			const swaps = await getIdeaSwaps(["political_power_bonus2"]);
			assert.strictEqual(swaps.length, 1);
		});

		it("reads every candidate file but keeps only the ones that mention a swap", async () => {
			await getIdeaSwaps(["political_power_bonus"]);
			assert.ok(readFiles.includes("common/national_focus/plain.txt"));
			assert.deepStrictEqual(await getIdeaSwaps(["something"]), []);
		});

		it("builds once and serves later lookups from the built index", async () => {
			await Promise.all([getIdeaSwaps(["political_power_bonus"]), getIdeaSwaps(["political_power_bonus"])]);
			const readsAfterBuild = readFiles.length;
			await getIdeaSwaps(["political_power_bonus"]);
			assert.strictEqual(readFiles.length, readsAfterBuild);
		});

		it("follows a chain out past the idea it was asked about", async () => {
			stubFiles({
				"common/national_focus/chain.txt": Buffer.from(`
                swap_ideas = { remove_idea = a add_idea = b }
                swap_ideas = { remove_idea = b add_idea = c }
                swap_ideas = { remove_idea = x add_idea = y }
            `),
			});
			const swaps = await getIdeaSwaps(["a"]);
			assert.deepStrictEqual(swaps.map(s => [s.from, s.to]), [["a", "b"], ["b", "c"]]);
		});

		it("does not walk into a chain the seed never touches", async () => {
			stubFiles({
				"common/national_focus/chain.txt": Buffer.from(`
                swap_ideas = { remove_idea = a add_idea = b }
                swap_ideas = { remove_idea = x add_idea = y }
            `),
			});
			const swaps = await getIdeaSwaps(["a"]);
			assert.deepStrictEqual(swaps.map(s => [s.from, s.to]), [["a", "b"]]);
		});

		it("terminates on a cycle rather than walking it forever", async () => {
			stubFiles({
				"common/national_focus/cycle.txt": Buffer.from(`
                swap_ideas = { remove_idea = a add_idea = b }
                swap_ideas = { remove_idea = b add_idea = a }
            `),
			});
			const swaps = await getIdeaSwaps(["a"]);
			assert.strictEqual(swaps.length, 2);
		});

		describe("incremental events", () => {
			it("ignores an event that arrives before any build has started", async () => {
				__testHandlers.onDeleteFiles({ files: [workspaceFile("common/national_focus/00_generic.txt")] });
				await settle();
				assert.deepStrictEqual(readFiles, []);
				const swaps = await getIdeaSwaps(["political_power_bonus"]);
				assert.strictEqual(swaps.length, 1);
			});

			it("drops a deleted file's swaps out of the index", async () => {
				assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);
				__testHandlers.onDeleteFiles({ files: [workspaceFile("common/national_focus/00_generic.txt")] });
				await settle();
				assert.deepStrictEqual(await getIdeaSwaps(["political_power_bonus"]), []);
			});

			it("re-reads a created file", async () => {
				assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);
				__testHandlers.onDeleteFiles({ files: [workspaceFile("common/national_focus/00_generic.txt")] });
				await settle();
				__testHandlers.onCreateFiles({ files: [workspaceFile("common/national_focus/00_generic.txt")] });
				await settle();
				assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);
			});

			it("ignores a file outside the roots it scans", async () => {
				assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);
				const before = readFiles.length;
				__testHandlers.onCreateFiles({ files: [workspaceFile("localisation/english/x.txt")] });
				await settle();
				assert.strictEqual(readFiles.length, before);
			});
		});
	});

	describe("re-indexing an edited file", () => {
		beforeEach(async () => {
			assert.deepStrictEqual(await swapFiles(), [SWAP_FILE]);
		});

		function closeDirty(): void {
			__testHandlers.onCloseTextDocument({ uri: workspaceFile(SWAP_FILE), isDirty: true } as unknown as vscode.TextDocument);
		}

		it("keeps the file's swaps when it can't be read", async () => {
			mock.method(Logger, "warn", () => undefined);
			mock.method(Logger, "error", () => undefined);
			world.read = () => {
				throw new Error("file gone mid-edit");
			};
			closeDirty();
			await settle();
			assert.deepStrictEqual(await swapFiles(), [SWAP_FILE]);
		});

		it("keeps the file's swaps when it doesn't parse midway through an edit", async () => {
			const logs: string[] = [];
			mock.method(Logger, "error", (message: string) => {
				logs.push(message);
			});
			mock.method(hoiparser, "parseHoi4File", () => {
				throw new Error("half-typed swap block");
			});
			closeDirty();
			await settle();
			assert.deepStrictEqual(await swapFiles(), [SWAP_FILE]);
			assert.ok(logs.some((line) => line.includes("half-typed swap block")));
		});

		it("drops the file once an edit leaves it naming swap_ideas with nothing to swap", async () => {
			world.read = () => Buffer.from("focus = { completion_reward = { swap_ideas = { } } }");
			closeDirty();
			await settle();
			assert.deepStrictEqual(await swapFiles(), []);
		});
	});

	it("serves a warm build from the disk cache without reading the file again", async () => {
		world.useDisk();
		assert.deepStrictEqual(await swapFiles(), [SWAP_FILE]);
		const cache = world.cacheFile("ideaSwapIndex.workspace.manifest.json");
		for (let i = 0; i < 100 && !world.disk.has(cache); i++) {
			await settle();
		}
		const reads = world.reads;
		__resetIdeaSwapIndexForTests();
		assert.deepStrictEqual(await swapFiles(), [SWAP_FILE]);
		assert.strictEqual(world.reads, reads);
	});
});
