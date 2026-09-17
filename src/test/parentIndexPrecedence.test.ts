import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import { contextContainer } from "../context";
import { getGfxContainerFile, __resetGfxIndexForTests } from "../util/gfxindex";
import {
	getLocalisedText,
	__resetLocalisationIndexForTests,
} from "../util/localisationIndex";
import {
	findFileByFocusKey,
	__resetSharedFocusIndexForTests,
} from "../util/sharedFocusIndex";
import {
	getIdeaSwaps,
	__resetIdeaSwapIndexForTests,
} from "../util/ideaSwapIndex";
import { clearParentModCache } from "../util/parentmods";
import { __resetIndexProgressForTests } from "../util/indexBuild";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

type ListedEntry = {
	relativePath: string;
	uri: unknown;
	mtime: number | undefined;
};

type SourceOptions = {
	mod?: boolean;
	workspace?: boolean;
	parent?: boolean;
	parentModUris?: readonly vscode.Uri[];
};

type FileloaderModule = {
	listFileEntriesFromModOrHOI4: (
		relativePath: string,
		options?: SourceOptions & { recursively?: boolean; token?: unknown },
	) => Promise<ListedEntry[]>;
	readFileFromModOrHOI4: (
		relativePath: string,
		options?: SourceOptions,
	) => Promise<[Buffer, unknown]>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;
const parentPaths = ["/parent-one", "/parent-two"];
const WORKSPACE_FOLDER = {
	uri: { path: "/ws", scheme: "file", toString: () => "file:///ws" },
} as unknown as vscode.WorkspaceFolder;

type IndexKind = "gfx" | "localisation" | "focus" | "swap";
let kind: IndexKind;
let firstParentReadStarted: boolean;
let secondParentReadStarted: boolean;
let releaseFirstParentRead: { resolve: () => void; promise: Promise<void> };
let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
let originalContext: vscode.ExtensionContext | null;

function toEntries(names: string[]): ListedEntry[] {
	return names.map((relativePath) => ({
		relativePath,
		uri: undefined,
		mtime: 1,
	}));
}

function deferred(): { resolve: () => void; promise: Promise<void> } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { resolve, promise };
}

function parentNumber(options: SourceOptions | undefined): number {
	const path = options?.parentModUris?.[0]?.path ?? "";
	return path.includes("parent-one") ? 0 : 1;
}

function fileNameForParent(parent: number): string {
	switch (kind) {
		case "gfx":
			return parent === 0 ? "first.gfx" : "second.gfx";
		case "localisation":
			return parent === 0 ? "first_l_english.yml" : "second_l_english.yml";
		case "focus":
			return parent === 0 ? "first.txt" : "second.txt";
		case "swap":
			return "same.txt";
	}
}

function contentForParent(parent: number): Buffer {
	switch (kind) {
		case "gfx":
			return Buffer.from(
				`spriteTypes = { spriteType = { name = "GFX_parent_precedence" texturefile = "${parent}.dds" } }`,
			);
		case "localisation":
			return Buffer.from(
				`l_english:\n PARENT_PRECEDENCE:0 "parent ${parent}"\n EMPTY_PARENT_PRECEDENCE:0 "${parent === 0 ? "" : "second parent"}"\n`,
			);
		case "focus":
			return Buffer.from("shared_focus = { id = parent_precedence_focus }");
		case "swap":
			return Buffer.from(
				`focus = { completion_reward = { swap_ideas = { remove_idea = parent_precedence_from add_idea = parent_precedence_to_${parent} } } }`,
			);
	}
}

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

async function lookupAfterSecondParentRead<T>(lookup: Promise<T>): Promise<T> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (firstParentReadStarted && secondParentReadStarted) {
			break;
		}
		await waitForAsyncTasks();
	}
	assert.strictEqual(firstParentReadStarted, true);
	assert.strictEqual(secondParentReadStarted, true);
	releaseFirstParentRead.resolve();
	return lookup;
}

describe("ordered parent index precedence", function () {
	beforeEach(function () {
		kind = "gfx";
		firstParentReadStarted = false;
		secondParentReadStarted = false;
		originalContext = contextContainer.current;
		contextContainer.current = null;
		releaseFirstParentRead = deferred();
		__resetGfxIndexForTests();
		__resetLocalisationIndexForTests();
		__resetSharedFocusIndexForTests();
		__resetIdeaSwapIndexForTests();
		originalListFiles = fileloader.listFileEntriesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;
		stubVscode({
			getConfiguration: () => ({
				gfxIndex: true,
				localisationIndex: true,
				sharedFocusIndex: true,
				ideaSwapIndex: true,
				parentModPaths: parentPaths,
			}),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		clearParentModCache();
		featureflags.refreshFeatureFlags();

		(fileloader as any).listFileEntriesFromModOrHOI4 = async (
			relativePath: string,
			options: SourceOptions,
		) => {
			if (options?.mod === false || options?.workspace !== false) {
				return [];
			}
			if (kind === "swap" && relativePath !== "common") {
				return [];
			}
			return toEntries([fileNameForParent(parentNumber(options))]);
		};
		(fileloader as any).readFileFromModOrHOI4 = async (
			relativePath: string,
			options: SourceOptions,
		) => {
			const parent = parentNumber(options);
			if (parent === 0) {
				firstParentReadStarted = true;
				await releaseFirstParentRead.promise;
			} else {
				secondParentReadStarted = true;
			}
			return [contentForParent(parent), {} as unknown];
		};
	});

	afterEach(function () {
		(fileloader as any).listFileEntriesFromModOrHOI4 = originalListFiles;
		(fileloader as any).readFileFromModOrHOI4 = originalReadFile;
		contextContainer.current = originalContext;
		restoreVscodeStubs();
		clearParentModCache();
		featureflags.refreshFeatureFlags();
		__resetGfxIndexForTests();
		__resetLocalisationIndexForTests();
		__resetSharedFocusIndexForTests();
		__resetIdeaSwapIndexForTests();
		__resetIndexProgressForTests();
	});

	it("uses the first parent for a duplicate GFX sprite after it reads last", async function () {
		kind = "gfx";
		const lookup = getGfxContainerFile("GFX_parent_precedence");
		assert.strictEqual(
			await lookupAfterSecondParentRead(lookup),
			"interface/first.gfx",
		);
	});

	it("uses the first parent for a duplicate localisation key after it reads last", async function () {
		kind = "localisation";
		const lookup = getLocalisedText("PARENT_PRECEDENCE", "en");
		assert.strictEqual(await lookupAfterSecondParentRead(lookup), "parent 0");
	});

	it("keeps an empty value from the first parent", async function () {
		kind = "localisation";
		const lookup = getLocalisedText("EMPTY_PARENT_PRECEDENCE", "en");
		assert.strictEqual(await lookupAfterSecondParentRead(lookup), "");
	});

	it("uses the first parent for a duplicate shared focus ID after it reads last", async function () {
		kind = "focus";
		const lookup = findFileByFocusKey("parent_precedence_focus");
		assert.strictEqual(
			await lookupAfterSecondParentRead(lookup),
			"common/national_focus/first.txt",
		);
	});

	it("uses the first parent for a same-relative-path idea swap after it reads last", async function () {
		kind = "swap";
		const lookup = getIdeaSwaps(["parent_precedence_from"]);
		const swaps = await lookupAfterSecondParentRead(lookup);
		assert.deepStrictEqual(
			swaps.map((swap) => [swap.from, swap.to, swap.file]),
			[["parent_precedence_from", "parent_precedence_to_0", "common/same.txt"]],
		);
	});
});
