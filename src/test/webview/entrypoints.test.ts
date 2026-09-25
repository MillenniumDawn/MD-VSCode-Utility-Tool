import { canvasCalls, postedMessages, resetWebviewState, takePostedMessages } from "./setup";
import * as assert from "assert";
import { vscode } from "../../../webviewsrc/util/vscode";

type Listener = (event: Event) => unknown;
type CapturedListeners = Record<string, Listener[]>;
type Entrypoint = "gfx" | "techtree" | "guipreview" | "worldmap";

function captureEntrypoint(name: Entrypoint): CapturedListeners {
	const captured: CapturedListeners = {};
	const originalAddEventListener = window.addEventListener;
	(window as any).addEventListener = (type: string, listener: Listener) => {
		(captured[type] ??= []).push(listener);
	};
	try {
		switch (name) {
			case "gfx":
				require("../../../webviewsrc/gfx");
				break;
			case "techtree":
				require("../../../webviewsrc/techtree");
				break;
			case "guipreview":
				require("../../../webviewsrc/guipreview");
				break;
			case "worldmap":
				require("../../../webviewsrc/worldmap/index");
				break;
		}
	} finally {
		(window as any).addEventListener = originalAddEventListener;
	}
	return captured;
}

function run(captured: CapturedListeners, type: string, event: Event): void {
	for (const listener of captured[type] ?? []) {
		listener(event);
	}
}

function runMessage(captured: CapturedListeners, data: unknown): void {
	run(
		captured,
		"message",
		new (window as any).MessageEvent("message", { data }),
	);
}

function withQuietScrolling<T>(fn: () => T): T {
	const originalScroll = window.scroll;
	const originalScrollTo = window.scrollTo;
	(window as any).scroll = () => undefined;
	(window as any).scrollTo = () => undefined;
	try {
		return fn();
	} finally {
		(window as any).scroll = originalScroll;
		(window as any).scrollTo = originalScrollTo;
	}
}

// The shared post log, emptied first and handed over live, so an assertion inside `fn` sees
// everything posted up to that point.
function withPosts<T>(fn: (posts: unknown[]) => T): T {
	takePostedMessages();
	return fn(postedMessages);
}

function withoutWindowListeners<T>(fn: () => T): T {
	const originalAddEventListener = window.addEventListener;
	(window as any).addEventListener = () => undefined;
	try {
		return fn();
	} finally {
		(window as any).addEventListener = originalAddEventListener;
	}
}

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	id?: string,
	className?: string,
): HTMLElementTagNameMap[K] {
	const result = document.createElement(tag);
	if (id) {
		result.id = id;
	}
	if (className) {
		result.className = className;
	}
	return result;
}

function addSelectOption(
	select: HTMLSelectElement,
	value: string,
	text: string,
	enablesupplyarea?: string,
): void {
	const option = element("option");
	option.value = value;
	option.textContent = text;
	if (enablesupplyarea) {
		option.setAttribute("enablesupplyarea", enablesupplyarea);
	}
	select.append(option);
}

function addDivOption(
	parent: HTMLDivElement,
	value: string,
	enablesupplyarea?: string,
): void {
	const option = element("div");
	option.className = "option";
	option.setAttribute("value", value);
	if (enablesupplyarea) {
		option.setAttribute("enablesupplyarea", enablesupplyarea);
	}
	parent.append(option);
}

function installGfxShell(): void {
	document.body.replaceChildren();
	const filter = element("input", "filter");
	const styles = element("style", "gfx-server-styles");
	styles.textContent = ".old {}";
	const list = element("div", "gfx-image-list");
	for (const id of ["KeepMe", "other"]) {
		const sprite = element("div", id, "spriteTypePreview");
		list.append(sprite);
	}
	document.body.append(filter, styles, list);
}

// `countries` and `country` are what the host injects for the country dropdown; leaving them out is
// the country-icon setting being off, which is what every test but the country ones wants.
function installTechShell(
	countries: Record<string, { tag: string; label: string }[]> = {},
	country = "",
): void {
	document.body.replaceChildren();
	const folders = element("select", "folderSelector");
	addSelectOption(folders, "techfolder_a", "A");
	const refresh = element("button", "refresh");
	const styles = element("style", "tech-server-styles");
	styles.textContent = ".old {}";
	const content = element("div", "techtreecontent");
	for (const id of ["techfolder_a", "techfolder_b"]) {
		content.append(element("div", id, "techfolder"));
	}
	document.body.append(folders, refresh, styles, content);
	(window as any).techCountries = countries;
	(window as any).techCountry = country;
}

function installTechCountryShell(
	countries: Record<string, { tag: string; label: string }[]>,
	country = "",
): void {
	installTechShell(countries, country);
	const select = element("select", "tech-country");
	addSelectOption(select, "", "Generic");
	document.body.append(select);
}

function countryOptions(): string[] {
	const select = document.getElementById("tech-country") as HTMLSelectElement;
	return Array.from(select.options).map((o) => o.value);
}

function installGuiShell(): void {
	document.body.replaceChildren();
	const folders = element("select", "folderSelector");
	addSelectOption(folders, "containerwindow_main", "Main");
	const container = element(
		"div",
		"containerwindow_main",
		"containerwindow containerwindow_main",
	);
	const mainContent = element("div", "mainContent");
	const visibilityContent = element("div", "toggleVisibilityContent");
	visibilityContent.append(element("div", "toggleVisibilityContentInner"));
	const toggle = element("button", "toggleVisibility");
	const child = element("div", undefined, "childcontainerwindow_Child");
	container.append(child);
	document.body.append(
		folders,
		container,
		mainContent,
		visibilityContent,
		toggle,
	);
	(window as any).containerWindowToggles = {
		main: {
			content:
				'<input type="checkbox" class="toggleContainerWindowCheckbox" id="child" containerWindowName="Child">',
		},
	};
}

function installWorldMapShell(): void {
	document.body.replaceChildren();
	const viewmode = element("select", "viewmode");
	addSelectOption(viewmode, "province", "Province");
	addSelectOption(viewmode, "supplyarea", "Supply area", "true");
	const colorset = element("select", "colorset");
	addSelectOption(colorset, "provinceid", "Province ID");
	addSelectOption(colorset, "supplyareaid", "Supply area ID", "true");
	const display = element("div", "display", "select multiple-select");
	display.append(element("span", undefined, "value"));
	addDivOption(display, "edge");
	addDivOption(display, "supply", "false");
	const warningFilter = element(
		"div",
		"warningfilter",
		"select multiple-select",
	);
	warningFilter.append(element("span", undefined, "value"));
	addDivOption(warningFilter, "province");
	addDivOption(warningFilter, "supplyarea", "true");
	const searchBox = element("input", "searchbox");
	const search = element("button", "search");
	const refresh = element("button", "refresh");
	const exportButton = element("button", "export");
	const showWarnings = element("button", "show-warnings");
	const open = element("button", "open");
	const warningsContainer = element("div", "warnings-container");
	const warnings = element("textarea", "warnings");
	const canvas = element("canvas", "main-canvas");
	document.body.append(
		viewmode,
		colorset,
		display,
		warningFilter,
		searchBox,
		search,
		refresh,
		exportButton,
		showWarnings,
		open,
		warningsContainer,
		warnings,
		canvas,
	);
}

// The four card previews restore their filter selection at module scope, from a list declared
// further down the same file. In the bundler's ESM output that read lands in the list's temporal
// dead zone and the entry throws before it registers anything, so the reader gets the
// host-rendered toolbar over an empty canvas and nothing else. These tests compile to commonjs,
// where the same read is a property access that answers `undefined` rather than throwing -- which
// is why a green suite shipped it. What reaches the failure here is a selection already being
// stored: readFilterList then calls `.filter` on the list it was handed.
type CardEntrypoint =
	| "ideapreview"
	| "eventtree"
	| "characterpreview"
	| "decisiontree";

// The state key each one remembers its selection under, with a value that is one of its filters.
const cardEntrypointState: Record<CardEntrypoint, Record<string, unknown>> = {
	ideapreview: { ideaFilters: ["laws"] },
	eventtree: { eventFilters: ["mtth"] },
	characterpreview: { characterFilters: ["traits"] },
	decisiontree: { decisionFilters: ["missions"] },
};

// Re-evaluates one entry's module body. Each of these is already required at file scope by its own
// test file, so without dropping the cache entry the require below would hand back the instance
// that was built when nothing was stored and evaluate nothing at all.
function reloadCardEntrypoint(name: CardEntrypoint): void {
	const paths: Record<CardEntrypoint, string> = {
		ideapreview: require.resolve("../../../webviewsrc/ideapreview"),
		eventtree: require.resolve("../../../webviewsrc/eventtree"),
		characterpreview: require.resolve("../../../webviewsrc/characterpreview"),
		decisiontree: require.resolve("../../../webviewsrc/decisiontree"),
	};
	delete require.cache[paths[name]];
	withoutWindowListeners(() => {
		switch (name) {
			case "ideapreview":
				require("../../../webviewsrc/ideapreview");
				break;
			case "eventtree":
				require("../../../webviewsrc/eventtree");
				break;
			case "characterpreview":
				require("../../../webviewsrc/characterpreview");
				break;
			case "decisiontree":
				require("../../../webviewsrc/decisiontree");
				break;
		}
	});
}

resetWebviewState();
const gfx = captureEntrypoint("gfx");
const techtree = captureEntrypoint("techtree");
const guipreview = captureEntrypoint("guipreview");
const worldmap = captureEntrypoint("worldmap");

describe("webview entrypoints", () => {
	beforeEach(() => {
		resetWebviewState();
		document.body.replaceChildren();
	});

	it("restores the GFX filter and applies an in-place update", () => {
		installGfxShell();
		vscode.setState({ filter: "keep" });

		withQuietScrolling(() => run(gfx, "load", new Event("load")));

		assert.strictEqual(
			(document.getElementById("filter") as HTMLInputElement).value,
			"keep",
		);
		assert.strictEqual(
			(document.getElementById("KeepMe") as HTMLDivElement).style.display,
			"inline-block",
		);
		assert.strictEqual(
			(document.getElementById("other") as HTMLDivElement).style.display,
			"none",
		);

		runMessage(gfx, {
			type: "updateBody",
			styleCss: ".new {}",
			data: {
				contentHtml: '<div class="spriteTypePreview" id="KeepNew"></div>',
			},
		});

		assert.strictEqual(
			document.getElementById("gfx-server-styles")?.textContent,
			".new {}",
		);
		assert.strictEqual(
			(document.getElementById("KeepNew") as HTMLDivElement).style.display,
			"inline-block",
		);
	});

	it("wires GFX navigators when the page loads", () => {
		installGfxShell();
		const navigator = document.getElementById("KeepMe")!;
		navigator.classList.add("navigator");
		navigator.setAttribute("start", "5");
		navigator.setAttribute("end", "10");
		navigator.setAttribute("file", "test.txt");

		withPosts((posts) => {
			withQuietScrolling(() => run(gfx, "load", new Event("load")));
			const space = new KeyboardEvent("keydown", {
				code: "Space",
				cancelable: true,
			});
			navigator.dispatchEvent(space);

			assert.strictEqual(space.defaultPrevented, true);
			assert.deepStrictEqual(posts, [
				{ command: "navigate", start: 5, end: 10, file: "test.txt" },
			]);
		});
	});

	it("asks the host to reload when the GFX update target is absent", () => {
		installGfxShell();
		document.getElementById("gfx-image-list")!.remove();

		withPosts((posts) => {
			runMessage(gfx, { type: "updateBody", data: { contentHtml: "" } });
			assert.deepStrictEqual(posts, [{ command: "reload" }]);
		});
	});

	it("keeps the technology folder selection while replacing its content", () => {
		installTechShell();
		vscode.setState({ folder: "techfolder_a" });

		withQuietScrolling(() => run(techtree, "load", new Event("load")));
		runMessage(techtree, {
			type: "updateBody",
			styleCss: ".new {}",
			data: {
				folders: ["b"],
				folderOptionsHtml: '<option value="techfolder_b">B</option>',
				contentHtml: '<div class="techfolder" id="techfolder_b"></div>',
			},
		});

		assert.strictEqual(
			(document.getElementById("folderSelector") as HTMLSelectElement).value,
			"techfolder_b",
		);
		assert.strictEqual(
			document.getElementById("tech-server-styles")?.textContent,
			".new {}",
		);
		assert.strictEqual(
			(document.getElementById("techfolder_b") as HTMLDivElement).style.display,
			"block",
		);
	});

	// The tree is drawn on the host, so the country dropdown is the one control here that cannot apply
	// itself: it tells the host which country to draw and the host sends the markup back. These cover
	// the page keeping that dropdown honest -- listing the countries with art for the folder on
	// screen, never losing the reader's choice, and reporting it once.
	const techCountries = {
		a: [
			{ tag: "GER", label: "Germany (GER)" },
			{ tag: "USA", label: "United States (USA)" },
		],
		b: [{ tag: "SOV", label: "Soviet Union (SOV)" }],
	};

	it("lists the countries with art for the folder on screen, and restores the stored choice", () => {
		installTechCountryShell(techCountries, "USA");
		vscode.setState({ folder: "techfolder_a" });

		withQuietScrolling(() => run(techtree, "load", new Event("load")));

		assert.deepStrictEqual(countryOptions(), ["", "GER", "USA"]);
		assert.strictEqual(
			(document.getElementById("tech-country") as HTMLSelectElement).value,
			"USA",
		);
	});

	it("re-lists on a folder change, carrying a choice the new folder has no art for", () => {
		installTechCountryShell(techCountries, "USA");
		addSelectOption(
			document.getElementById("folderSelector") as HTMLSelectElement,
			"techfolder_b",
			"B",
		);
		vscode.setState({ folder: "techfolder_a" });
		withQuietScrolling(() => run(techtree, "load", new Event("load")));

		const folders = document.getElementById(
			"folderSelector",
		) as HTMLSelectElement;
		folders.value = "techfolder_b";
		folders.dispatchEvent(new Event("change"));

		// USA has no art in this folder, but dropping it would silently disagree with the host, which
		// is still drawing the tree for USA.
		assert.deepStrictEqual(countryOptions(), ["", "SOV", "USA"]);
		assert.strictEqual(
			(document.getElementById("tech-country") as HTMLSelectElement).value,
			"USA",
		);
	});

	it("tells the host once when the reader picks a country", () => {
		installTechCountryShell(techCountries, "");
		vscode.setState({ folder: "techfolder_a" });
		withQuietScrolling(() => run(techtree, "load", new Event("load")));

		withPosts((posts) => {
			const country = document.getElementById(
				"tech-country",
			) as HTMLSelectElement;
			country.value = "GER";
			country.dispatchEvent(new Event("change"));

			assert.deepStrictEqual(posts, [
				{
					command: "setPreviewOption",
					key: "technology.country",
					value: "GER",
				},
			]);
		});
	});

	it("re-lists from an in-place update that carries new countries", () => {
		installTechCountryShell(techCountries, "GER");
		vscode.setState({ folder: "techfolder_a" });
		withQuietScrolling(() => run(techtree, "load", new Event("load")));

		withPosts((posts) => {
			runMessage(techtree, {
				type: "updateBody",
				data: {
					folders: ["a"],
					countries: { a: [{ tag: "USA", label: "United States (USA)" }] },
				},
			});

			assert.deepStrictEqual(countryOptions(), ["", "USA", "GER"]);
			// The update is the host answering an edit, not the reader choosing again.
			assert.deepStrictEqual(posts, []);
		});
	});

	it("follows the country the host says it drew", () => {
		// The host drops a stored tag no folder in the file has art for. Without hearing that, the page
		// re-adds it and the selector claims a country the tree is drawn generic for.
		installTechCountryShell(techCountries, "FRA");
		vscode.setState({ folder: "techfolder_a" });
		withQuietScrolling(() => run(techtree, "load", new Event("load")));
		assert.deepStrictEqual(countryOptions(), ["", "GER", "USA", "FRA"]);

		runMessage(techtree, {
			type: "updateBody",
			data: { folders: ["a"], countries: techCountries, country: "" },
		});

		assert.deepStrictEqual(countryOptions(), ["", "GER", "USA"]);
		assert.strictEqual(
			(document.getElementById("tech-country") as HTMLSelectElement).value,
			"",
		);
	});

	it("keeps the reader's choice when an update carries no country", () => {
		installTechCountryShell(techCountries, "USA");
		vscode.setState({ folder: "techfolder_a" });
		withQuietScrolling(() => run(techtree, "load", new Event("load")));

		runMessage(techtree, {
			type: "updateBody",
			data: { folders: ["a"], countries: techCountries },
		});

		assert.strictEqual(
			(document.getElementById("tech-country") as HTMLSelectElement).value,
			"USA",
		);
	});

	it("leaves the page alone when the country setting is off", () => {
		installTechShell();
		vscode.setState({ folder: "techfolder_a" });

		withQuietScrolling(() => run(techtree, "load", new Event("load")));

		assert.strictEqual(document.getElementById("tech-country"), null);
	});

	it("restores GUI visibility and persists child-window changes", () => {
		installGuiShell();
		withQuietScrolling(() => run(guipreview, "load", new Event("load")));

		const toggle = document.getElementById(
			"toggleVisibility",
		) as HTMLButtonElement;
		const mainContent = document.getElementById(
			"mainContent",
		) as HTMLDivElement;
		assert.strictEqual(toggle.disabled, false);
		assert.strictEqual(mainContent.style.marginTop, "40px");

		toggle.dispatchEvent(new Event("click"));
		assert.strictEqual(mainContent.style.marginTop, "240px");
		assert.strictEqual(
			(document.getElementById("toggleVisibilityContent") as HTMLDivElement)
				.style.display,
			"block",
		);

		const child = document.getElementById("child") as HTMLInputElement;
		child.checked = false;
		child.dispatchEvent(new Event("change"));
		assert.strictEqual(
			(document.querySelector(".childcontainerwindow_Child") as HTMLDivElement)
				.style.display,
			"none",
		);
		assert.strictEqual(
			vscode.getState().containerWindowVisibilities.child,
			false,
		);
	});

	it("keeps a GUI window apart from a sibling whose name is a prefix", () => {
		installGuiShell();
		const container = document.getElementById(
			"containerwindow_main",
		) as HTMLDivElement;
		const battle = element("div", undefined, "childcontainerwindow_battle");
		const map = element("div", undefined, "childcontainerwindow_map");
		battle.append(map);
		const battleplan = element(
			"div",
			undefined,
			"childcontainerwindow_battleplan",
		);
		container.replaceChildren(battle, battleplan);
		(window as any).containerWindowToggles = {
			main: {
				content: [
					["toggleContainerWindow_battle", "battle"],
					["toggleContainerWindow_battle_map", "map"],
					["toggleContainerWindow_battleplan", "battleplan"],
				]
					.map(
						([id, name]) =>
							`<input type="checkbox" class="toggleContainerWindowCheckbox" id="${id}" containerWindowName="${name}">`,
					)
					.join(""),
			},
		};
		withQuietScrolling(() => run(guipreview, "load", new Event("load")));

		const box = (id: string) =>
			document.getElementById(
				"toggleContainerWindow_" + id,
			) as HTMLInputElement;
		const setChecked = (id: string, checked: boolean) => {
			box(id).checked = checked;
			box(id).dispatchEvent(new Event("change"));
		};

		setChecked("battleplan", false);
		assert.strictEqual(battleplan.style.display, "none");
		assert.strictEqual(box("battle").checked, true);
		assert.strictEqual(battle.style.display, "block");

		setChecked("battleplan", true);
		setChecked("battle", false);
		assert.strictEqual(box("battle_map").checked, false);
		assert.strictEqual(box("battleplan").checked, true);
		assert.strictEqual(battleplan.style.display, "block");

		setChecked("battleplan", false);
		setChecked("battleplan", true);
		assert.strictEqual(box("battle").checked, false);
		assert.strictEqual(battle.style.display, "none");
	});

	it("starts the world-map loader and hides supply-area controls when disabled", () => {
		installWorldMapShell();
		(window as any).__enableSupplyArea = false;
		const originalRequestAnimationFrame = (globalThis as any)
			.requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = (
			callback: (time: number) => void,
		) => {
			callback(0);
			return 0;
		};

		try {
			withPosts((posts) => {
				withoutWindowListeners(() =>
					withQuietScrolling(() => run(worldmap, "load", new Event("load"))),
				);
				assert.ok(
					posts.some((message) => (message as any).command === "loaded"),
				);
			});
			assert.strictEqual(
				document.querySelectorAll('[enablesupplyarea="true"]').length,
				0,
			);
			const mainCanvas = document.getElementById(
				"main-canvas",
			) as HTMLCanvasElement;
			assert.ok(
				canvasCalls(mainCanvas).some((call) => call.method === "drawImage"),
			);
		} finally {
			(globalThis as any).requestAnimationFrame = originalRequestAnimationFrame;
		}
	});
});

describe("webview card entrypoints", () => {
	beforeEach(() => {
		resetWebviewState();
		document.body.replaceChildren();
	});

	for (const name of Object.keys(cardEntrypointState) as CardEntrypoint[]) {
		it(`${name} evaluates with a stored filter selection`, () => {
			vscode.setState(cardEntrypointState[name]);

			assert.doesNotThrow(() => reloadCardEntrypoint(name));
		});
	}
});
