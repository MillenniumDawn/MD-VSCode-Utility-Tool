import * as assert from "assert";
import * as featureflags from "../util/featureflags";
import {
	getGfxContainerFile,
	registerGfxIndex,
	__resetGfxIndexForTests,
} from "../util/gfxindex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

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

const GFX_FILE_CONTENT = Buffer.from(`spriteTypes = {
	spriteType = {
		name = "GFX_my_sprite"
		texturefile = "does-not-exist.dds"
	}
}`);

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/gfxindex lazy build", function () {
	let originalListFiles: FileloaderModule["listFilesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let listFilesCallCount: number;

	beforeEach(function () {
		__resetGfxIndexForTests();
		stubVscode({
			getConfiguration: () => ({ gfxIndex: true }),
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
			return ["sprite.gfx"];
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async () => [GFX_FILE_CONTENT, {} as unknown];
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
		__resetGfxIndexForTests();
	});

	it("does no build work when registered", async function () {
		const disposable = registerGfxIndex();
		await waitForAsyncTasks();

		assert.strictEqual(listFilesCallCount, 0);
		disposable.dispose();
	});

	it("does no build work when the feature flag is off", async function () {
		stubVscode({ getConfiguration: () => ({ gfxIndex: false }) });
		featureflags.refreshFeatureFlags();

		const result = await getGfxContainerFile("GFX_my_sprite");

		assert.strictEqual(result, undefined);
		assert.strictEqual(listFilesCallCount, 0);
	});

	it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async function () {
		const [first, second] = await Promise.all([
			getGfxContainerFile("GFX_my_sprite"),
			getGfxContainerFile("GFX_my_sprite"),
		]);

		// One list call for the global build, one for the workspace build; a duplicate build would double these.
		assert.strictEqual(listFilesCallCount, 2);
		assert.strictEqual(first, "interface/sprite.gfx");
		assert.strictEqual(second, "interface/sprite.gfx");

		const third = await getGfxContainerFile("GFX_my_sprite");
		assert.strictEqual(third, "interface/sprite.gfx");
		assert.strictEqual(listFilesCallCount, 2);
	});
});
