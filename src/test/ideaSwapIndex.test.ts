import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import { parseHoi4File } from "../hoiformat/hoiparser";
import {
	extractIdeaSwaps,
	getIdeaSwaps,
	registerIdeaSwapIndex,
	__resetIdeaSwapIndexForTests,
	__testHandlers,
} from "../util/ideaSwapIndex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// The swaps below are transcribed from Millennium Dawn's common/national_focus/00_generic.txt,
// where the political_power_bonus chain is performed.

describe("util/ideaSwapIndex extraction", () => {
	function swapsOf(input: string) {
		return extractIdeaSwaps(parseHoi4File(input));
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

		assert.deepStrictEqual(
			swaps.map((s) => [s.from, s.to]),
			[["political_power_bonus", "political_power_bonus2"]],
		);
	});

	it("records where the swap was written so a chain arrow can jump to it", () => {
		const source = `completion_reward = { swap_ideas = { remove_idea = a add_idea = b } }`;
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

		assert.deepStrictEqual(
			swaps.map((s) => [s.from, s.to]),
			[
				["a1", "b1"],
				["a2", "b2"],
			],
		);
	});

	// Mismatched counts have no obvious pairing, so every combination is kept rather than the
	// extras being dropped.
	it("keeps every combination when the counts do not match", () => {
		const swaps = swapsOf(`
            swap_ideas = { remove_idea = a1 add_idea = b1 add_idea = b2 }
        `);

		assert.deepStrictEqual(
			swaps.map((s) => [s.from, s.to]),
			[
				["a1", "b1"],
				["a1", "b2"],
			],
		);
	});

	it("ignores a block that names only one side, or names the same idea twice", () => {
		assert.deepStrictEqual(swapsOf(`swap_ideas = { remove_idea = a }`), []);
		assert.deepStrictEqual(swapsOf(`swap_ideas = { add_idea = b }`), []);
		assert.deepStrictEqual(swapsOf(`swap_ideas = { remove_idea = a add_idea = a }`), []);
	});

	it("finds nothing in a file that performs no swap", () => {
		assert.deepStrictEqual(
			swapsOf(`focus = { completion_reward = { add_idea = political_power_bonus } }`),
			[],
		);
	});
});

type FileloaderModule = {
	listFilesFromModOrHOI4: (
		relativePath: string,
		options?: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
	) => Promise<string[]>;
	readFileFromModOrHOI4: (
		relativePath: string,
		options?: { mod?: boolean; hoi4?: boolean },
	) => Promise<[Buffer, unknown]>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

const SWAP_FILE = Buffer.from(
	"focus = { completion_reward = { swap_ideas = { remove_idea = political_power_bonus add_idea = political_power_bonus2 } } }",
);
// The prescan's whole point: a file that never says swap_ideas is never parsed.
const PLAIN_FILE = Buffer.from("focus = { completion_reward = { add_idea = something } }");

const WORKSPACE_FOLDER = {
	uri: { path: "/ws", scheme: "file", toString: () => "file:///ws" },
} as unknown as vscode.WorkspaceFolder;

function fileUri(relativePath: string): vscode.Uri {
	const fullPath = "/ws/" + relativePath;
	return {
		path: fullPath,
		scheme: "file",
		toString: () => "file://" + fullPath,
	} as unknown as vscode.Uri;
}

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/ideaSwapIndex registration", () => {
	it("returns a disposable", () => {
		const disposable = registerIdeaSwapIndex();
		assert.ok(disposable);
		assert.strictEqual(typeof disposable.dispose, "function");
		disposable.dispose();
	});
});

describe("util/ideaSwapIndex lookup", function () {
	let originalListFiles: FileloaderModule["listFilesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let readFiles: string[];

	function stubFiles(files: Record<string, Buffer>) {
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = async (relativePath, options) => {
			if (options?.hoi4) {
				return [];
			}
			return Object.keys(files)
				.filter((f) => f.startsWith(relativePath + "/"))
				.map((f) => f.slice(relativePath.length + 1));
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async (relativePath) => {
			readFiles.push(relativePath);
			const content = files[relativePath];
			if (!content) {
				throw new Error("no such file " + relativePath);
			}
			return [content, {} as unknown];
		};
	}

	beforeEach(function () {
		__resetIdeaSwapIndexForTests();
		stubVscode({
			getConfiguration: () => ({ ideaSwapIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		featureflags.refreshFeatureFlags();

		readFiles = [];
		originalListFiles = fileloader.listFilesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;
		stubFiles({
			"common/national_focus/00_generic.txt": SWAP_FILE,
			"common/national_focus/plain.txt": PLAIN_FILE,
		});
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = originalListFiles;
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = originalReadFile;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		__resetIdeaSwapIndexForTests();
	});

	it("does no work at all when the setting is off", async function () {
		stubVscode({ getConfiguration: () => ({ ideaSwapIndex: false }) });
		featureflags.refreshFeatureFlags();

		assert.deepStrictEqual(await getIdeaSwaps(["political_power_bonus"]), []);
		assert.deepStrictEqual(readFiles, []);
	});

	it("does no work for an empty seed", async function () {
		assert.deepStrictEqual(await getIdeaSwaps([]), []);
		assert.deepStrictEqual(readFiles, []);
	});

	it("finds the swap an idea takes part in", async function () {
		const swaps = await getIdeaSwaps(["political_power_bonus"]);

		assert.deepStrictEqual(
			swaps.map((s) => [s.from, s.to, s.file]),
			[
				[
					"political_power_bonus",
					"political_power_bonus2",
					"common/national_focus/00_generic.txt",
				],
			],
		);
	});

	it("finds the same swap from the idea it swaps into", async function () {
		const swaps = await getIdeaSwaps(["political_power_bonus2"]);
		assert.strictEqual(swaps.length, 1);
	});

	it("reads every candidate file but keeps only the ones that mention a swap", async function () {
		await getIdeaSwaps(["political_power_bonus"]);

		// Both are read -- the prescan is on the text, so it cannot skip the read -- but only the
		// one that says swap_ideas ends up in the index.
		assert.ok(readFiles.includes("common/national_focus/plain.txt"));
		const swaps = await getIdeaSwaps(["something"]);
		assert.deepStrictEqual(swaps, []);
	});

	it("builds once and serves later lookups from the built index", async function () {
		await Promise.all([
			getIdeaSwaps(["political_power_bonus"]),
			getIdeaSwaps(["political_power_bonus"]),
		]);
		const readsAfterBuild = readFiles.length;

		await getIdeaSwaps(["political_power_bonus"]);
		assert.strictEqual(readFiles.length, readsAfterBuild);
	});

	it("follows a chain out past the idea it was asked about", async function () {
		__resetIdeaSwapIndexForTests();
		stubFiles({
			"common/national_focus/chain.txt": Buffer.from(`
                swap_ideas = { remove_idea = a add_idea = b }
                swap_ideas = { remove_idea = b add_idea = c }
                swap_ideas = { remove_idea = x add_idea = y }
            `),
		});

		const swaps = await getIdeaSwaps(["a"]);

		// b was never asked for, but it is how a reaches c.
		assert.deepStrictEqual(
			swaps.map((s) => [s.from, s.to]),
			[
				["a", "b"],
				["b", "c"],
			],
		);
	});

	it("does not walk into a chain the seed never touches", async function () {
		__resetIdeaSwapIndexForTests();
		stubFiles({
			"common/national_focus/chain.txt": Buffer.from(`
                swap_ideas = { remove_idea = a add_idea = b }
                swap_ideas = { remove_idea = x add_idea = y }
            `),
		});

		const swaps = await getIdeaSwaps(["a"]);
		assert.deepStrictEqual(
			swaps.map((s) => [s.from, s.to]),
			[["a", "b"]],
		);
	});

	it("terminates on a cycle rather than walking it forever", async function () {
		__resetIdeaSwapIndexForTests();
		stubFiles({
			"common/national_focus/cycle.txt": Buffer.from(`
                swap_ideas = { remove_idea = a add_idea = b }
                swap_ideas = { remove_idea = b add_idea = a }
            `),
		});

		const swaps = await getIdeaSwaps(["a"]);
		assert.strictEqual(swaps.length, 2);
	});

	describe("incremental events", function () {
		it("ignores an event that arrives before any build has started", async function () {
			__testHandlers.onDeleteFiles({
				files: [fileUri("common/national_focus/00_generic.txt")],
			});
			await waitForAsyncTasks();

			assert.deepStrictEqual(readFiles, []);
			const swaps = await getIdeaSwaps(["political_power_bonus"]);
			assert.strictEqual(swaps.length, 1);
		});

		it("drops a deleted file's swaps out of the index", async function () {
			assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);

			__testHandlers.onDeleteFiles({
				files: [fileUri("common/national_focus/00_generic.txt")],
			});
			await waitForAsyncTasks();

			assert.deepStrictEqual(await getIdeaSwaps(["political_power_bonus"]), []);
		});

		it("re-reads a created file", async function () {
			assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);

			__testHandlers.onDeleteFiles({
				files: [fileUri("common/national_focus/00_generic.txt")],
			});
			await waitForAsyncTasks();
			__testHandlers.onCreateFiles({
				files: [fileUri("common/national_focus/00_generic.txt")],
			});
			await waitForAsyncTasks();

			assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);
		});

		it("ignores a file outside the roots it scans", async function () {
			assert.strictEqual((await getIdeaSwaps(["political_power_bonus"])).length, 1);
			const before = readFiles.length;

			__testHandlers.onCreateFiles({ files: [fileUri("localisation/english/x.txt")] });
			await waitForAsyncTasks();

			assert.strictEqual(readFiles.length, before);
		});
	});
});
