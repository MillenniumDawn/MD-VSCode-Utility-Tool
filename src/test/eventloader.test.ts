import * as assert from "assert";
import { EventsLoader } from "../previewdef/event/loader";
import { LoaderSession } from "../util/loader/loader";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

describe("previewdef/event/loader", function () {
	afterEach(function () {
		restoreVscodeStubs();
	});

	// A `#!localisation:` dependency is one parsed .yml document per file, not an array, so it must
	// not go through the element-wise merge the events dependencies use: that merge iterated the
	// document and threw "not iterable" on the first one, taking the whole preview down with it.
	it("merges a #!localisation: dependency into the localisation dictionary", async function () {
		const files: Record<string, string> = {
			"localisation/english/test_l_english.yml":
				"l_english:\n test.1.t: \"A title\"\n test.1.d: \"A description\"\n",
		};
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			stat: async () => ({ type: 1, mtime: 1, ctime: 0, size: 0 }),
			readFile: async (uri: { fsPath?: string; path?: string }) => {
				const path = String(uri.fsPath ?? uri.path ?? "").replace(/\\/g, "/");
				const match = Object.keys(files).find((f) => path.endsWith(f));
				if (match === undefined) {
					throw new Error(`no stub for ${path}`);
				}
				return Buffer.from(files[match]!);
			},
		});

		const loader = new EventsLoader("events/test.txt", async () =>
			"#!localisation:localisation/english/test_l_english.yml\n" +
			"add_namespace = test\n" +
			"country_event = { id = test.1 title = test.1.t desc = test.1.d }\n",
		);
		const result = await loader.load(new LoaderSession(false));

		assert.strictEqual(result.result.localizationDict["test.1.t"], "A title");
		assert.strictEqual(result.result.localizationDict["test.1.d"], "A description");
		assert.ok(result.dependencies.includes("localisation/english/test_l_english.yml"));
	});
});
