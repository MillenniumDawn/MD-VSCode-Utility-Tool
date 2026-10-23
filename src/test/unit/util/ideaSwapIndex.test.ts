import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import * as hoiparser from "../../../hoiformat/hoiparser";
import { __resetIdeaSwapIndexForTests, __testHandlers, getIdeaSwaps } from "../../../util/ideaSwapIndex";
import { Logger } from "../../../util/logger";
import { settle } from "../async";
import { listed, useIndexWorld, workspaceFile } from "../indexes";

// What the swap index does with one file it already holds. The lookups and the chain walk are tested
// in the old suite's ideaSwapIndex.test.ts until it moves here.

const SWAP_FILE = "common/national_focus/swaps.txt";
const swap = Buffer.from("focus = { completion_reward = { swap_ideas = { remove_idea = a add_idea = b } } }");

async function swapFiles(): Promise<string[]> {
	return (await getIdeaSwaps(["a"])).map((found) => found.file);
}

describe("util/ideaSwapIndex", () => {
	const world = useIndexWorld(__resetIdeaSwapIndexForTests, { ideaSwapIndex: true });

	beforeEach(() => {
		world.list = (root, half) => (half === "workspace" && root === "common" ? listed(["national_focus/swaps.txt"]) : []);
		world.read = () => swap;
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
