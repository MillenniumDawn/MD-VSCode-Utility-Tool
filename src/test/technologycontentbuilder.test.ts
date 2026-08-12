import * as assert from "assert";
import * as vscode from "vscode";
import { renderTechnologyFile } from "../previewdef/technology/contentbuilder";
import {
	serializeUpdate,
	LoaderRenderResult,
} from "../previewdef/loaderpreview";

// renderTechnologyFile returns the in-place update parts { html, update } on success and a plain html
// string on the no-tree / error branches. These drive it against a stub loader (a countrytechtreeview
// with no folder children, so every folder takes the deterministic "can't find folder" fallback) to
// assert the return shape and that serializeUpdate is stable for identical input -- the property the
// LoaderPreview skip relies on -- and differs when the input changed.

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/technologies/test.txt");

function loaderFor(folders: string[]): any {
	return {
		load: async () => ({
			result: {
				technologyTrees: folders.map((folder) => ({
					startTechnology: `${folder}_start`,
					folder,
					technologies: [],
				})),
				guiFiles: [
					{
						file: "countrytechtreeview.gui",
						data: {
							guitypes: [
								{
									containerwindowtype: [
										{ name: "countrytechtreeview", containerwindowtype: [] },
									],
								},
							],
						},
					},
				],
				gfxFiles: [],
				equipmentArchetypes: {},
			},
		}),
	};
}

// The class list on an element carrying id="<id>", read out of the rendered html.
function classOf(html: string, id: string): string {
	const m = new RegExp(`id="${id}"[^>]*?class="([^"]*)"`).exec(html);
	assert.ok(m, `expected an element with id="${id}"`);
	return m![1].trim();
}

describe("previewdef/technology renderTechnologyFile in-place update", () => {
	it("returns { html, update } carrying contentHtml, folderOptionsHtml and folders", async () => {
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery", "infantry"]),
			uri,
			webview,
		)) as LoaderRenderResult;
		assert.strictEqual(typeof rendered, "object");
		assert.strictEqual(typeof rendered.html, "string");
		assert.ok(rendered.update);
		assert.strictEqual(typeof rendered.update.styleCss, "string");
		const data = rendered.update.data as {
			contentHtml: string;
			folderOptionsHtml: string;
			folders: string[];
		};
		assert.strictEqual(typeof data.contentHtml, "string");
		assert.strictEqual(typeof data.folderOptionsHtml, "string");
		assert.deepStrictEqual(data.folders, ["artillery", "infantry"]);
	});

	it("serializeUpdate is stable for identical input, even though the full html nonces differ", async () => {
		const a = (await renderTechnologyFile(
			loaderFor(["artillery", "infantry"]),
			uri,
			webview,
		)) as LoaderRenderResult;
		const b = (await renderTechnologyFile(
			loaderFor(["artillery", "infantry"]),
			uri,
			webview,
		)) as LoaderRenderResult;
		// The full html carries fresh CSP nonces per render so it never hashes equal; the update parts
		// must be byte-identical so a no-op edit skips.
		assert.notStrictEqual(a.html, b.html);
		assert.strictEqual(serializeUpdate(a.update!), serializeUpdate(b.update!));
	});

	it("serializeUpdate differs when the input changed", async () => {
		const a = (await renderTechnologyFile(
			loaderFor(["artillery", "infantry"]),
			uri,
			webview,
		)) as LoaderRenderResult;
		const c = (await renderTechnologyFile(
			loaderFor(["artillery", "armor"]),
			uri,
			webview,
		)) as LoaderRenderResult;
		assert.notStrictEqual(
			serializeUpdate(a.update!),
			serializeUpdate(c.update!),
		);
	});

	it("gives the shell elements suffix-free stable class names carried by the pushed styleCss", async () => {
		// The shell (folder toolbar, #dragger, #techtreecontent wrapper) lives outside the swapped
		// content, so its classes must be suffix-free style() names, not per-render oneTimeStyle ids,
		// or an in-place update's styleCss would have no rule for the class still on the live element.
		const a = (await renderTechnologyFile(
			loaderFor(["artillery", "infantry"]),
			uri,
			webview,
		)) as LoaderRenderResult;
		const b = (await renderTechnologyFile(
			loaderFor(["artillery", "armor"]),
			uri,
			webview,
		)) as LoaderRenderResult;

		for (const rendered of [a, b]) {
			const styleCss = rendered.update!.styleCss!;
			assert.strictEqual(classOf(rendered.html, "dragger"), "st-dragger");
			assert.ok(
				classOf(rendered.html, "techtreecontent")
					.split(" ")
					.includes("st-mainContent"),
			);
			assert.ok(styleCss.includes(".st-dragger {"));
			assert.ok(styleCss.includes(".st-mainContent {"));
			assert.ok(styleCss.includes(".st-folderSelectorBar {"));
		}
	});

	it("returns a plain string (no update parts) for the no-technology-tree page", async () => {
		const rendered = await renderTechnologyFile(loaderFor([]), uri, webview);
		assert.strictEqual(typeof rendered, "string");
	});

	it("returns a plain string for the error page when the loader throws", async () => {
		const throwing: any = {
			load: async () => {
				throw new Error("boom");
			},
		};
		const rendered = await renderTechnologyFile(throwing, uri, webview);
		assert.strictEqual(typeof rendered, "string");
	});

	it("renders a technology node inside the folder", async () => {
		const loader: any = {
			load: async () => ({
				result: {
					technologyTrees: [
						{
							startTechnology: "start",
							folder: "infantry",
							technologies: [
								{
									id: "test_tech",
									name: "Test Tech",
									x: 0,
									y: 0,
									cost: 10,
									icon: "GFX_test",
									token: { start: 0, end: 5 },
								},
							],
						},
					],
					guiFiles: [
						{
							file: "countrytechtreeview.gui",
							data: {
								guitypes: [
									{
										containerwindowtype: [
											{ name: "countrytechtreeview", containerwindowtype: [] },
										],
									},
								],
							},
						},
					],
					gfxFiles: [],
					equipmentArchetypes: {},
				},
			}),
		};
		const rendered = (await renderTechnologyFile(
			loader,
			uri,
			webview,
		)) as LoaderRenderResult;
		assert.ok(typeof rendered === "object");
		assert.ok(rendered.update);
		const data = rendered.update!.data as {
			contentHtml: string;
			folders: string[];
		};
		assert.ok(data.contentHtml.length > 0);
		assert.ok(data.folders.includes("infantry"));
	});
});
