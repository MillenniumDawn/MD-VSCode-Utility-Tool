import * as assert from "assert";
import * as featureflags from "../util/featureflags";
import { Logger } from "../util/logger";
import { registerGfxIndex } from "../util/gfxindex";
import { registerLocalisationIndex } from "../util/localisationIndex";
import { registerSharedFocusIndex } from "../util/sharedFocusIndex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

type FileloaderModule = {
	listFilesFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			recursively?: boolean;
		},
	) => Promise<string[]>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util index registration failure path", function () {
	let logs: string[];
	let originalLoggerError: (message: string) => void;
	let originalListFiles: FileloaderModule["listFilesFromModOrHOI4"];
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

		originalLoggerError = Logger.error;
		Logger.error = (message: string) => {
			logs.push(message);
		};

		originalListFiles = fileloader.listFilesFromModOrHOI4;
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = async () => {
			throw new Error("listing failed intentionally");
		};
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = originalListFiles;
		Logger.error = originalLoggerError;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
	});

	async function assertRegisterFailure(
		action: () => { dispose: () => void },
		expectedContext: string,
	): Promise<void> {
		const disposable = action();
		await waitForAsyncTasks();

		assert.ok(
			logs.some(
				(message) =>
					message === `${expectedContext}: Error: listing failed intentionally`,
			),
		);
		disposable.dispose();
	}

	it("registerGfxIndex reports a contextual build failure", async function () {
		await assertRegisterFailure(
			() => registerGfxIndex(),
			"Building GFX index failed.",
		);
	});

	it("registerLocalisationIndex reports a contextual build failure", async function () {
		await assertRegisterFailure(
			() => registerLocalisationIndex(),
			"Building Localisation index failed.",
		);
	});

	it("registerSharedFocusIndex reports a contextual build failure", async function () {
		await assertRegisterFailure(
			() => registerSharedFocusIndex(),
			"Building Shared Focus index failed.",
		);
	});
});
