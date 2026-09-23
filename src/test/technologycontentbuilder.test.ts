import * as assert from "assert";
import * as vscode from "vscode";
import {
	renderTechnologyFile,
	getTechnologyIconNames,
	findXorGroups,
} from "../previewdef/technology/contentbuilder";
import {
	hashUpdate,
	renderedHtml,
	LoaderRenderResult,
} from "../previewdef/loaderpreview";
import * as featureflags from "../util/featureflags";
import { contextContainer } from "../context";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
import { stubLocalisation, restoreLocalisation } from "./_localisation_stub";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { convertNodeToJson } from "../hoiformat/schema";
import { GuiFile, guiFileSchema } from "../hoiformat/gui";
import { Technology } from "../previewdef/technology/schema";

// renderTechnologyFile returns the in-place update parts { html, update } on success and a plain html
// string on the no-tree / error branches. These drive it against a stub loader (a countrytechtreeview
// with no folder children, so every folder takes the deterministic "can't find folder" fallback) to
// assert the return shape and that hashUpdate is stable for identical input -- the property the
// LoaderPreview skip relies on -- and differs when the input changed.

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/technologies/test.txt");

function loaderFor(
	folders: string[],
	countryTagsByFolder?: Record<string, string[]>,
): any {
	return {
		load: async () => ({
			result: {
				countryTagsByFolder,
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
		assert.strictEqual(typeof rendered.html, "function");
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

	it("hashUpdate is stable for identical input, even though the full html nonces differ", async () => {
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
		assert.notStrictEqual(renderedHtml(a), renderedHtml(b));
		assert.strictEqual(hashUpdate(a.update!), hashUpdate(b.update!));
	});

	it("hashUpdate differs when the input changed", async () => {
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
			hashUpdate(a.update!),
			hashUpdate(c.update!),
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
			assert.strictEqual(classOf(renderedHtml(rendered), "dragger"), "st-dragger");
			assert.ok(
				classOf(renderedHtml(rendered), "techtreecontent")
					.split(" ")
					.includes("st-mainContent"),
			);
			assert.ok(styleCss.includes(".st-dragger {"));
			assert.ok(styleCss.includes(".st-mainContent {"));
			assert.ok(styleCss.includes(".st-folderSelectorBar {"));
		}
	});

	it("escapes a folder name carrying quotes and angle brackets everywhere it is written into markup", async () => {
		// The parser accepts quoted identifiers, so a folder name is workspace text. It lands in the
		// selector <option>, the folder div's id and, with this stub's tree view having no folder
		// children, the "can't find folder" fallback message.
		const hostileFolder = 'arty" onload="x<b>';
		const rendered = (await renderTechnologyFile(
			loaderFor([hostileFolder]),
			uri,
			webview,
		)) as LoaderRenderResult;
		const data = rendered.update!.data as { folderOptionsHtml: string; folders: string[] };

		assert.ok(!renderedHtml(rendered).includes(hostileFolder), renderedHtml(rendered));
		assert.ok(!renderedHtml(rendered).includes("<b>"), renderedHtml(rendered));
		assert.ok(!data.folderOptionsHtml.includes(hostileFolder), data.folderOptionsHtml);
		assert.ok(renderedHtml(rendered).includes('<option value="techfolder_arty&quot; onload=&quot;x&lt;b&gt;">arty&quot;&nbsp;onload=&quot;x&lt;b&gt;</option>'), renderedHtml(rendered));
		assert.ok(renderedHtml(rendered).includes('id="techfolder_arty&quot; onload=&quot;x&lt;b&gt;"'), renderedHtml(rendered));
		// The page matches option values and ids against these raw names after the browser has
		// decoded the attributes, so the data itself stays unescaped.
		assert.deepStrictEqual(data.folders, [hostileFolder]);
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

describe("previewdef/technology render session", () => {
	function recordingLoader(sessions: { force: boolean }[]): any {
		const base = loaderFor(["artillery"]);
		return {
			load: async (session: { force: boolean }) => {
				sessions.push(session);
				return base.load();
			},
		};
	}

	// The loader reads the .gui and .gfx files, the equipment archetypes and the country tags. An edit
	// to one of those arrives as dependencyChanged while this preview's own document is untouched, so
	// without forcing the session the loader hands back what it read before the edit and the panel
	// repaints stale content.
	it("forces the loader session when a dependency changed", async () => {
		const sessions: { force: boolean }[] = [];
		await renderTechnologyFile(recordingLoader(sessions), uri, webview, {
			partial: true,
			dependencyChanged: true,
		});

		assert.deepStrictEqual(
			sessions.map((s) => s.force),
			[true],
		);
	});

	it("does not force it for an ordinary edit, so unchanged loads still come from the cache", async () => {
		const sessions: { force: boolean }[] = [];
		await renderTechnologyFile(recordingLoader(sessions), uri, webview, {
			partial: true,
			dependencyChanged: false,
		});
		await renderTechnologyFile(recordingLoader(sessions), uri, webview);

		assert.deepStrictEqual(
			sessions.map((s) => s.force),
			[false, false],
		);
	});
});

describe("previewdef/technology getTechnologyIconNames", () => {
	const placeholder = "GFX_technology_medium";

	it("keeps today's order when no country is chosen", () => {
		assert.deepStrictEqual(
			getTechnologyIconNames("APC_1", undefined, placeholder),
			["GFX_APC_1_medium", "GFX_APC_1", placeholder],
		);
	});

	it("puts the chosen country's art ahead of the generic icon, both forms", () => {
		// The country's icon has to win, and the generic entries have to stay: a country with no art
		// of its own for this technology falls through to them rather than to the placeholder.
		assert.deepStrictEqual(getTechnologyIconNames("APC_1", "USA", placeholder), [
			"GFX_USA_APC_1_medium",
			"GFX_USA_APC_1",
			"GFX_APC_1_medium",
			"GFX_APC_1",
			placeholder,
		]);
	});
});

describe("previewdef/technology country selector", () => {
	afterEach(() => {
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		contextContainer.current = null;
	});

	function withCountryIcons(on: boolean): void {
		stubVscode({ getConfiguration: () => ({ technologyCountryIcons: on }) });
		featureflags.refreshFeatureFlags();
	}

	// The picked country lives in globalState, which is where getSelectedCountry reads it back from.
	function withStoredCountry(tag: string): void {
		const store: Record<string, unknown> = { "previewOption.technology.country": tag };
		contextContainer.current = {
			globalState: {
				get: (key: string) => store[key],
				update: (key: string, value: unknown) => {
					store[key] = value;
					return Promise.resolve();
				},
			},
		} as unknown as vscode.ExtensionContext;
	}

	function countryOf(rendered: LoaderRenderResult): unknown {
		return (rendered.update!.data as { country: unknown }).country;
	}

	it("is left out of the toolbar when the setting is off", async () => {
		withCountryIcons(false);
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery"]),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.ok(!renderedHtml(rendered).includes('id="tech-country"'));
	});

	it("is drawn with only the generic option, which the page fills in per folder", async () => {
		withCountryIcons(true);
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery"]),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.ok(renderedHtml(rendered).includes('id="tech-country"'));
		// The selection is deliberately not baked into the shell: a country change is applied by an
		// in-place update, which cannot patch the shell, so anything of the choice written here would
		// force a full page reload instead.
		assert.ok(!/id="tech-country"[\s\S]*?selected/.test(renderedHtml(rendered)));
	});

	it("hands the page the country lists, so it can re-list them per folder", async () => {
		withCountryIcons(true);
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery"]),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.ok(renderedHtml(rendered).includes("window.techCountries = "));
		assert.ok(renderedHtml(rendered).includes("window.techCountry = "));
		assert.ok((rendered.update!.data as { countries: unknown }).countries);
	});

	it("escapes a tag that would otherwise end the inline script", async () => {
		// The tags are read from the workspace. The HTML parser ends the script at the first
		// `</script`, whatever the JavaScript around it means.
		withCountryIcons(true);
		const hostileTag = "</script><img src=x>";
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery"], { artillery: [hostileTag] }),
			uri,
			webview,
		)) as LoaderRenderResult;

		const script = /window\.techCountries = (.*?);<\/script>/s.exec(renderedHtml(rendered));
		assert.ok(script, "expected the countries payload script");
		assert.ok(!script![1]!.includes("</script"), script![1]!);
		const countries = JSON.parse(script![1]!);
		assert.strictEqual(countries.artillery[0].tag, hostileTag);
	});

	// The full html injects window.techCountry, so an in-place update that leaves it out lets the page
	// keep listing a country the host stopped drawing for.
	it("carries the country the tree was drawn for in the update", async () => {
		withCountryIcons(true);
		withStoredCountry("USA");
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery"], { artillery: ["GER", "USA"] }),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.strictEqual(countryOf(rendered), "USA");
	});

	it("reports the generic tree when the stored country was dropped", async () => {
		withCountryIcons(true);
		withStoredCountry("USA");
		// No folder in this file has USA art, so the tree is drawn generic; the page has to hear that or
		// its selector goes on saying USA.
		const rendered = (await renderTechnologyFile(
			loaderFor(["artillery"], { artillery: ["GER"] }),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.strictEqual(countryOf(rendered), "");
	});

	it("hashUpdate differs when only the country changed", async () => {
		// Otherwise the payload hashes equal and the in-place update is skipped, leaving the dropdown
		// moved and the tree not.
		withCountryIcons(true);
		const tags = { artillery: ["GER", "USA"] };

		withStoredCountry("USA");
		const a = (await renderTechnologyFile(
			loaderFor(["artillery"], tags),
			uri,
			webview,
		)) as LoaderRenderResult;

		withStoredCountry("GER");
		const b = (await renderTechnologyFile(
			loaderFor(["artillery"], tags),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.notStrictEqual(hashUpdate(a.update!), hashUpdate(b.update!));
	});
});

// A technology's tooltip is its id and, with the localisation index on, the localised name copied
// verbatim out of the .yml -- so the name has to be escaped for the attribute it is written into,
// exactly as the id beside it already is.
describe("previewdef/technology renderTechnology escaping", () => {
	afterEach(() => restoreLocalisation());

	// The smallest tree view that reaches renderTechnology: the folder window holding the tree's
	// gridbox, an item window for the technology and a slot in it for the sub-technology.
	const guiText = `
		guiTypes = {
			containerWindowType = {
				name = "countrytechtreeview"
				containerWindowType = {
					name = "infantry"
					gridboxType = { name = "start_tree" position = { x = 0 y = 0 } slotsize = { width = 100 height = 100 } format = "UP" }
				}
			}
			containerWindowType = {
				name = "techtree_infantry_item"
				size = { width = 100 height = 100 }
				containerWindowType = { name = "sub_technology_slot_0" size = { width = 40 height = 40 } }
				containerWindowType = { name = "sub_technology_slot_1" size = { width = 40 height = 40 } }
			}
		}`;

	function technology(id: string, subTechnologies: Technology[] = [], overrides: Partial<Technology> = {}): Technology {
		return {
			id,
			folders: { infantry: { name: "infantry", x: 0, y: 0 } },
			leadsToTechs: [],
			xor: [],
			startYear: 2000,
			enableEquipments: true,
			enableEquipmentNames: [],
			categories: [],
			isSpecialProject: false,
			subTechnologies,
			token: { start: 0, end: 5 } as Technology["token"],
			...overrides,
		};
	}

	function loaderWithTree(technologies: Technology[]): any {
		return {
			load: async () => ({
				result: {
					technologyTrees: [{ startTechnology: "start", folder: "infantry", technologies }],
					guiFiles: [{ file: "countrytechtreeview.gui", data: convertNodeToJson<GuiFile>(parseHoi4File(guiText), guiFileSchema) }],
					gfxFiles: [],
					equipmentArchetypes: {},
				},
			}),
		};
	}

	it("escapes the localised technology and sub-technology names in their tooltips", async () => {
		const hostile = 'x" onmouseover="alert(1)" y="<b>';
		stubLocalisation({ start: hostile, start_sub: hostile });
		const rendered = (await renderTechnologyFile(
			loaderWithTree([technology("start", [technology("start_sub")])]),
			uri,
			webview,
		)) as LoaderRenderResult;
		const contentHtml = (rendered.update!.data as { contentHtml: string }).contentHtml;

		assert.ok(contentHtml.includes('data-tech-id="start"'), contentHtml);
		assert.ok(contentHtml.includes('data-subtech-id="start_sub"'), contentHtml);
		assert.ok(!contentHtml.includes('onmouseover="'), contentHtml);
		assert.ok(!contentHtml.includes("<b>"), contentHtml);
		assert.ok(contentHtml.includes('title="start\nx&quot; onmouseover=&quot;alert(1)&quot; y=&quot;&lt;b&gt;'), contentHtml);
		assert.ok(contentHtml.includes('title="start_sub\nx&quot; onmouseover=&quot;alert(1)&quot; y=&quot;&lt;b&gt;'), contentHtml);
	});

	async function contentOf(technologies: Technology[]): Promise<string> {
		const rendered = (await renderTechnologyFile(loaderWithTree(technologies), uri, webview)) as LoaderRenderResult;
		return (rendered.update!.data as { contentHtml: string }).contentHtml;
	}

	// The markup of one sub-technology: from its opening div up to the next sub-technology or the end.
	function subTechnologyHtml(contentHtml: string, id: string): string {
		const start = contentHtml.indexOf(`data-subtech-id="${id}"`);
		assert.ok(start >= 0, `no sub-technology ${id} in ${contentHtml}`);
		const next = contentHtml.indexOf("data-subtech-id=", start + 1);
		return contentHtml.slice(start, next < 0 ? undefined : next);
	}

	it("puts each sub-technology in its own slot and leaves a slot without one empty", async () => {
		stubLocalisation({});
		const contentHtml = await contentOf([technology("start", [technology("only_sub")])]);

		assert.strictEqual(contentHtml.match(/data-subtech-id=/g)?.length, 1, contentHtml);
		assert.ok(contentHtml.includes('data-subtech-id="only_sub"'), contentHtml);
	});

	it("marks a special-project sub-technology and only that one", async () => {
		stubLocalisation({});
		const contentHtml = await contentOf([technology("start", [
			technology("plain_sub"),
			technology("sp_sub", [], { isSpecialProject: true }),
		])]);

		assert.ok(subTechnologyHtml(contentHtml, "sp_sub").includes("st-techSpecialProject"), contentHtml);
		assert.ok(!subTechnologyHtml(contentHtml, "plain_sub").includes("st-techSpecialProject"), contentHtml);
	});
});

// The children a technology leads to, split into the ones drawn side by side and the groups that
// exclude each other, which the tree draws in an xor frame.
describe("previewdef/technology findXorGroups", () => {
	function tech(id: string, overrides: Partial<Technology> = {}): Technology {
		return {
			id,
			folders: { infantry: { name: "infantry", x: 0, y: 0 } },
			leadsToTechs: [],
			xor: [],
			startYear: 2000,
			enableEquipments: true,
			enableEquipmentNames: [],
			categories: [],
			isSpecialProject: false,
			subTechnologies: [],
			token: undefined,
			...overrides,
		};
	}

	function tree(...technologies: Technology[]): Record<string, Technology> {
		return Object.fromEntries(technologies.map(t => [t.id, t]));
	}

	const ids = (groups: Technology[][] | undefined) => groups?.map(group => group.map(t => t.id).sort());

	it("returns undefined when no child is exclusive with another", () => {
		const root = tech("root", { leadsToTechs: ["a", "b"] });
		assert.strictEqual(findXorGroups(tree(root, tech("a"), tech("b")), root, "infantry"), undefined);
	});

	it("ignores an xor that only one side declares", () => {
		const root = tech("root", { leadsToTechs: ["a", "b"] });
		const map = tree(root, tech("a", { xor: ["b"] }), tech("b"));
		assert.strictEqual(findXorGroups(map, root, "infantry"), undefined);
	});

	it("groups a mutual pair and lists the other children first", () => {
		const root = tech("root", { leadsToTechs: ["a", "b", "c"] });
		const map = tree(root, tech("a", { xor: ["b"] }), tech("b", { xor: ["a"] }), tech("c"));
		assert.deepStrictEqual(ids(findXorGroups(map, root, "infantry")), [["c"], ["a", "b"]]);
	});

	it("merges pairs that share a technology into one group", () => {
		const root = tech("root", { leadsToTechs: ["a", "b", "c"] });
		const map = tree(
			root,
			tech("a", { xor: ["b"] }),
			tech("b", { xor: ["a", "c"] }),
			tech("c", { xor: ["b"] }),
		);
		assert.deepStrictEqual(ids(findXorGroups(map, root, "infantry")), [[], ["a", "b", "c"]]);
	});

	it("leaves out children that are not in the folder being drawn", () => {
		const root = tech("root", { leadsToTechs: ["a", "b", "elsewhere"] });
		const map = tree(
			root,
			tech("a", { xor: ["b", "elsewhere"] }),
			tech("b", { xor: ["a"] }),
			tech("elsewhere", { xor: ["a"], folders: { armor: { name: "armor", x: 0, y: 0 } } }),
		);
		assert.deepStrictEqual(ids(findXorGroups(map, root, "infantry")), [[], ["a", "b"]]);
	});
});
