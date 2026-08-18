import * as assert from "assert";
import * as featureflags from "../util/featureflags";
import {
	findFileByFocusKey,
	registerSharedFocusIndex,
	__resetSharedFocusIndexForTests,
} from "../util/sharedFocusIndex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

describe("util/sharedFocusIndex", () => {
	it("findFileByFocusKey returns undefined for unknown key", async () => {
		assert.strictEqual(
			await findFileByFocusKey("nonexistent_key_123"),
			undefined,
		);
	});

	it("registerSharedFocusIndex returns a disposable", () => {
		const disposable = registerSharedFocusIndex();
		assert.ok(disposable);
		assert.strictEqual(typeof disposable.dispose, "function");
		disposable.dispose();
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

const SHARED_FOCUS_FILE_CONTENT = Buffer.from(
	"shared_focus = { id = my_shared_focus }",
);

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/sharedFocusIndex lazy build", function () {
	let originalListFiles: FileloaderModule["listFilesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let listFilesCallCount: number;

	beforeEach(function () {
		__resetSharedFocusIndexForTests();
		stubVscode({
			getConfiguration: () => ({ sharedFocusIndex: true }),
		});
		featureflags.refreshFeatureFlags();

		listFilesCallCount = 0;
		originalListFiles = fileloader.listFilesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;

		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = async () => {
			listFilesCallCount++;
			return ["shared.txt"];
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async () => [
			SHARED_FOCUS_FILE_CONTENT,
			{} as unknown,
		];
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
		__resetSharedFocusIndexForTests();
	});

	it("does no build work when registered", async function () {
		const disposable = registerSharedFocusIndex();
		await waitForAsyncTasks();

		assert.strictEqual(listFilesCallCount, 0);
		disposable.dispose();
	});

	it("does no build work when the feature flag is off", async function () {
		stubVscode({ getConfiguration: () => ({ sharedFocusIndex: false }) });
		featureflags.refreshFeatureFlags();

		const result = await findFileByFocusKey("my_shared_focus");

		assert.strictEqual(result, undefined);
		assert.strictEqual(listFilesCallCount, 0);
	});

	it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async function () {
		const [first, second] = await Promise.all([
			findFileByFocusKey("my_shared_focus"),
			findFileByFocusKey("my_shared_focus"),
		]);

		// One list call for the global build, one for the workspace build; a duplicate build would double these.
		assert.strictEqual(listFilesCallCount, 2);
		assert.strictEqual(first, "common/national_focus/shared.txt");
		assert.strictEqual(second, "common/national_focus/shared.txt");

		const third = await findFileByFocusKey("my_shared_focus");
		assert.strictEqual(third, "common/national_focus/shared.txt");
		assert.strictEqual(listFilesCallCount, 2);
	});
});
