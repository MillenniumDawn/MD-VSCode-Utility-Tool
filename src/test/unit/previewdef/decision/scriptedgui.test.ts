import * as assert from "assert";
import { mock } from "node:test";
import * as nodePath from "path";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import { ScriptedGuisLoader, scriptedGuisByName } from "../../../../previewdef/decision/scriptedgui";
import * as fileloader from "../../../../util/fileloader";
import { LoaderSession } from "../../../../util/loader/loader";
import { handOver } from "../../host";

const readable = `scripted_gui = {
	knesset = { window_name = "KNESSET" context_type = decision_category unused = yes }
	plain = { }
}
not_scripted = { dropped = { window_name = "NO" } }
scripted_gui = {
	knesset = { window_name = "LATER" }
}`;

describe("previewdef/decision/scriptedgui", () => {
	beforeEach(() => {
		handOver({
			window: { createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }) },
		});
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it("reads every named gui, skips a file that does not parse, and keeps the first of a repeated name", async () => {
		mock.method(fileloader, "listFilesFromModOrHOI4", async () => ["good.txt", "bad.txt", "empty.txt"]);
		mock.method(fileloader, "hoiFileExpiryToken", async () => "v1");
		mock.method(fileloader, "parseHoi4FileCached", async (path: string) => {
			if (path.endsWith("bad.txt")) {
				throw new Error("half typed");
			}
			if (path.endsWith("empty.txt")) {
				return { value: "not a block" };
			}
			return parseHoi4File(readable);
		});

		const loader = new ScriptedGuisLoader();
		const result = await loader.load(new LoaderSession(true));
		const names = result.result.map((gui) => [gui.name, gui.windowName, gui.contextType]);

		assert.deepStrictEqual(names, [
			["knesset", "KNESSET", "decision_category"],
			["plain", undefined, undefined],
			["knesset", "LATER", undefined],
		]);
		assert.strictEqual(scriptedGuisByName(result.result).knesset?.windowName, "KNESSET");
		assert.deepStrictEqual(result.dependencies, ["common/scripted_guis/*"]);
		assert.strictEqual(loader.toString(), "[ScriptedGuisLoader]");
		assert.strictEqual(
			(loader as any).subLoaders["good.txt"].toString(),
			`[ScriptedGuiFileLoader: ${nodePath.join("common/scripted_guis", "good.txt")}]`,
		);
	});
});
