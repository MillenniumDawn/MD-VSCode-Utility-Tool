import * as assert from "assert";
import { afterEach, describe, it } from "mocha";
import { openOrCopyHoiFile } from "../util/previewfileopener";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

describe("util/previewfileopener", () => {
	afterEach(() => {
		restoreVscodeStubs();
	});

	it("shows an error when the file is not in the mod and no workspace is open", async () => {
		const messages: string[] = [];
		stubVscode({
			showErrorMessage: async (message: string) => {
				messages.push(message);
				return undefined;
			},
		});

		await openOrCopyHoiFile("common/ideas/missing.txt", 0, 10, {
			mustOpenFolderMessage: "Open a folder first",
			selectFolderMessage: "Choose a folder",
			failedToOpenMessage: (error) => `Failed: ${error}`,
		});

		assert.deepStrictEqual(messages, ["Open a folder first"]);
	});
});
