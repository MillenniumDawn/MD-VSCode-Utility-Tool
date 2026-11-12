import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { GuiFileLoader } from "../../../../previewdef/gui/loader";
import * as fileloader from "../../../../util/fileloader";
import { LoaderSession } from "../../../../util/loader/loader";
import { handOver } from "../../host";

const file = "interface/window.gui";
const companion = "interface/window.gfx";
const content = "guiTypes = { containerWindowType = { name = window } }";

function uri(path: string): vscode.Uri {
	return { path } as vscode.Uri;
}

describe("previewdef/gui/loader companion GFX", () => {
	let available: Set<string>;
	let checked: string[];

	beforeEach(() => {
		available = new Set();
		checked = [];
		handOver({ workspace: { getConfiguration: () => ({}) } });
		mock.method(fileloader, "getFilePathFromModOrHOI4", async (path: string) => {
			checked.push(path);
			return available.has(path) ? uri(path) : undefined;
		});
		mock.method(fileloader, "hoiFileExpiryToken", async () => "unchanged");
	});

	afterEach(() => mock.restoreAll());

	it("omits a missing implicit companion but keeps its dependency for later creation", async () => {
		const loaded = await new GuiFileLoader(file, async () => content).load(new LoaderSession(false));

		assert.deepStrictEqual(checked, [companion]);
		assert.deepStrictEqual(loaded.result.gfxFiles, []);
		assert.deepStrictEqual(loaded.dependencies, [file, companion]);
		assert.strictEqual(loaded.result.guiFiles[0]?.data.guitypes[0]?.containerwindowtype[0]?.name, "window");
	});

	it("finds the companion of a GUI with an uppercase extension", async () => {
		available.add(companion);
		const loaded = await new GuiFileLoader("interface/window.GUI", async () => content).load(new LoaderSession(false));

		assert.deepStrictEqual(checked, [companion]);
		assert.deepStrictEqual(loaded.result.gfxFiles, [companion]);
	});

	it("keeps an existing companion before explicitly declared GFX files", async () => {
		available.add(companion);
		const explicit = "interface/shared.gfx";
		const loaded = await new GuiFileLoader(file, async () => `#!gfx: ${explicit}\n${content}`)
			.load(new LoaderSession(false));

		assert.deepStrictEqual(loaded.result.gfxFiles, [companion, explicit]);
		assert.deepStrictEqual(loaded.dependencies, [file, companion, explicit]);
	});

	for (const explicit of ["interface/missing.gfx", companion]) {
		it(`retains an explicitly declared missing dependency: ${explicit}`, async () => {
			const loaded = await new GuiFileLoader(file, async () => `#!gfx: ${explicit}\n${content}`)
				.load(new LoaderSession(false));

			assert.deepStrictEqual(checked, [companion]);
			assert.deepStrictEqual(loaded.result.gfxFiles, [explicit]);
			assert.ok(loaded.dependencies.includes(explicit));
		});
	}

	it("retains included GUI files and their companion dependencies", async () => {
		const child = "interface/child.gui";
		const childCompanion = "interface/child.gfx";
		available.add(childCompanion);
		mock.method(fileloader, "readFileFromModOrHOI4", async (path: string) => {
			assert.strictEqual(path, child);
			return [Buffer.from(content.replace("name = window", "name = child")), uri(path)] as [Buffer, vscode.Uri];
		});
		const loaded = await new GuiFileLoader(file, async () => `#!gui: ${child}\n${content}`)
			.load(new LoaderSession(false));

		assert.deepStrictEqual(loaded.result.gfxFiles, [childCompanion]);
		assert.deepStrictEqual(loaded.result.guiFiles.map(gui => gui.file), [child, file]);
		for (const dependency of [file, companion, child, childCompanion]) {
			assert.ok(loaded.dependencies.includes(dependency), dependency);
		}
	});

	it("picks up companion creation and deletion when an unchanged GUI is refreshed for a dependency", async () => {
		const loader = new GuiFileLoader(file, async () => content);
		const initial = await loader.load(new LoaderSession(false));
		assert.deepStrictEqual(initial.result.gfxFiles, []);

		available.add(companion);
		assert.strictEqual(await loader.load(new LoaderSession(false)), initial);
		const created = await loader.load(new LoaderSession(true));
		assert.deepStrictEqual(created.result.gfxFiles, [companion]);

		available.delete(companion);
		const removed = await loader.load(new LoaderSession(true));
		assert.deepStrictEqual(removed.result.gfxFiles, []);
		assert.deepStrictEqual(removed.dependencies, [file, companion]);
	});

	it("does not hide a failure while resolving the companion", async () => {
		const failure = new Error("resolution failed");
		mock.method(fileloader, "getFilePathFromModOrHOI4", async () => { throw failure; });

		await assert.rejects(new GuiFileLoader(file, async () => content).load(new LoaderSession(false)),
			(error) => error === failure);
	});
});
