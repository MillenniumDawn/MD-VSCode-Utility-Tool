import * as assert from "assert";
import * as featureflags from "../util/featureflags";
import { Logger } from "../util/logger";
import {
	getGfxContainerFile,
	registerGfxIndex,
	__resetGfxIndexForTests,
} from "../util/gfxindex";
import {
	getLocalisedText,
	registerLocalisationIndex,
	__resetLocalisationIndexForTests,
} from "../util/localisationIndex";
import {
	findFileByFocusKey,
	__resetSharedFocusIndexForTests,
} from "../util/sharedFocusIndex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

type FileloaderModule = {
	listFileEntriesFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			recursively?: boolean;
			token?: unknown;
		},
	) => Promise<
		{ relativePath: string; uri: unknown; mtime: number | undefined }[]
	>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util index registration failure path", function () {
	let logs: string[];
	let originalLoggerError: (message: string) => void;
	let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
	beforeEach(function () {
		logs = [];
		stubVscode({
			getConfiguration: () => ({
				sharedFocusIndex: true,
				gfxIndex: true,
				localisationIndex: true,
			}),
		});
		featureflags.refreshFeatureFlags();
		__resetSharedFocusIndexForTests();
		__resetGfxIndexForTests();
		__resetLocalisationIndexForTests();

		originalLoggerError = Logger.error;
		Logger.error = (message: string) => {
			logs.push(message);
		};

		originalListFiles = fileloader.listFileEntriesFromModOrHOI4;
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = async () => {
			throw new Error("listing failed intentionally");
		};
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = originalListFiles;
		Logger.error = originalLoggerError;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		__resetSharedFocusIndexForTests();
		__resetGfxIndexForTests();
		__resetLocalisationIndexForTests();
	});

	it("registerGfxIndex only registers watchers, reporting no build failure", async function () {
		const disposable = registerGfxIndex();
		await waitForAsyncTasks();

		assert.strictEqual(logs.length, 0);
		disposable.dispose();
	});

	it("registerLocalisationIndex only registers watchers, reporting no build failure", async function () {
		const disposable = registerLocalisationIndex();
		await waitForAsyncTasks();

		assert.strictEqual(logs.length, 0);
		disposable.dispose();
	});

	it("getGfxContainerFile reports a contextual build failure on first use", async function () {
		await getGfxContainerFile("GFX_anything");
		await waitForAsyncTasks();

		assert.ok(
			logs.some(
				(message) =>
					message ===
					"[Index] gfxIndex: build failed: Error: listing failed intentionally",
			),
		);
	});

	it("getLocalisedText reports a contextual build failure on first use", async function () {
		await getLocalisedText("anything", "en");
		await waitForAsyncTasks();

		assert.ok(
			logs.some(
				(message) =>
					message ===
					"[Index] localisationIndex: build failed: Error: listing failed intentionally",
			),
		);
	});

	it("findFileByFocusKey reports a contextual build failure on first use", async function () {
		await findFileByFocusKey("anything");
		await waitForAsyncTasks();

		assert.ok(
			logs.some(
				(message) =>
					message ===
					"[Index] sharedFocusIndex: build failed: Error: listing failed intentionally",
			),
		);
	});
});
