import "./setup";
import * as assert from "assert";
import {
	IdeaCard,
	IdeaPreviewPayload,
	ModifierLine,
} from "../../previewdef/idea/payload";

// ideapreview.ts reads window.ideaPreview at module scope, so the payload has to exist before the
// import runs. This mirrors Millennium Dawn's Dutch ideas plus the generic political_power_bonus
// chain: two loose ideas, one of which borrows the other's name, and one chain that leaves the file.
const integrationPayload: IdeaPreviewPayload = {
	conditionExprs: [],
	toolbarFlags: {
		hasLocalisation: true,
		hasDescriptions: true,
		hasIcons: true,
		hasModifiers: true,
		hasResearch: true,
		hasConditions: true,
		hasLaws: true,
		hasDefaults: true,
		hasChains: true,
		chainsUnavailable: false,
	},
	groups: [
		{
			category: "country",
			isLaw: false,
			isDesigner: false,
			ideaIds: ["HOL_shell1", "HOL_shell3a", "political_power_bonus"],
			nav: { start: 0, end: 7, file: "common/ideas/test.txt" },
		},
		{
			category: "economic_cycles",
			isLaw: true,
			isDesigner: false,
			ideaIds: ["depression"],
		},
	],
	cards: [
		card("HOL_shell1", {
			name: { key: "HOL_shell1", text: "Royal Shell" },
			desc: { key: "HOL_shell1_desc", text: "Shell is an oil and gas company." },
			icon: { styleKey: "st-idea-icon-shell", width: 64, height: 64 },
			research: [
				{ key: "CAT_fuel_oil", name: "Fuel and Oil", value: "+5%", tone: "good" },
			],
			nav: { start: 20, end: 30, file: "common/ideas/test.txt" },
		}),
		card("HOL_shell3a", {
			name: { key: "HOL_shell2a", text: "Renewable Shell" },
			borrowsName: true,
		}),
		card("political_power_bonus", {
			name: { key: "political_power_bonus", text: "Political Power Bonus" },
			modifiers: [
				{
					key: "political_power_gain",
					name: "Daily Political Power Gain",
					value: "+0.3",
					tone: "good",
				},
			],
		}),
		card("depression", {
			name: { key: "depression", text: "Depression" },
			isLaw: true,
			isDefault: true,
			badges: ["Level 6"],
			modifiers: [
				{ key: "stability_factor", name: "Stability", value: "-10%", tone: "bad" },
			],
			allowed: { scopeName: "", nodeContent: "has_idea = depression" },
		}),
	],
	chains: [
		{
			ideaIds: ["political_power_bonus", "political_power_bonus2"],
			sources: [
				{ start: 5, end: 9, file: "common/national_focus/00_generic.txt" },
				undefined,
			],
		},
	],
};

function card(id: string, extra: Partial<IdeaCard> = {}): IdeaCard {
	return {
		id,
		category: "country",
		name: { key: id, text: id },
		desc: { key: `${id}_desc`, text: `${id}_desc` },
		borrowsName: false,
		isDefault: false,
		isLaw: false,
		badges: [],
		modifiers: [],
		research: [],
		targeted: [],
		equipment: [],
		allowed: true,
		available: true,
		hasEffects: false,
		...extra,
	};
}

(global as any).window.ideaPreview = integrationPayload;

// The shell the host renders. Installed from the rendering suite's before hook rather than at module
// scope: every webview test file shares one jsdom document, and writing body.innerHTML here would
// clobber whichever other file's fixture happened to load after this one.
const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <input type="checkbox" id="show-localisation">
        <input type="checkbox" id="show-icon">
        <input type="checkbox" id="show-modifiers">
        <input type="checkbox" id="show-description">
        <input type="checkbox" id="show-conditions">
        <div id="idea-filter-container">
            <div class="select-container">
                <div id="idea-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    <div class="option" value="laws">Laws</div>
                    <div class="option" value="default">Starting idea</div>
                    <div class="option" value="modifiers">Has modifiers</div>
                    <div class="option" value="research">Has research bonus</div>
                    <div class="option" value="conditions">Has conditions</div>
                    <div class="option" value="chains">In an idea chain</div>
                </div>
            </div>
        </div>
        <input type="text" id="idea-searchbox">
        <span id="idea-search-count"></span>
    </div></div>
    <div id="ideapreviewcontent"></div>`;

const ideapreview =
	require("../../../webviewsrc/ideapreview") as typeof import("../../../webviewsrc/ideapreview");
const {
	readFilters,
	matchesFilters,
	matchesQuery,
	chainedIds,
	chainsForGroups,
	conditionToDom,
	modifierLineToDom,
} = ideapreview;
type IdeaFilter = import("../../../webviewsrc/ideapreview").IdeaFilter;

function byId(id: string): IdeaCard {
	const found = integrationPayload.cards.find((c) => c.id === id);
	assert.ok(found, `expected a card for ${id}`);
	return found!;
}

describe("webview/ideapreview readFilters", () => {
	it("keeps only known values, in the toolbar's order", () => {
		assert.deepStrictEqual(readFilters(["chains", "laws", "nonsense"]), [
			"laws",
			"chains",
		]);
	});

	it("reads anything that is not a list as no selection at all", () => {
		assert.deepStrictEqual(readFilters(undefined), []);
		assert.deepStrictEqual(readFilters("laws"), []);
		assert.deepStrictEqual(readFilters(null), []);
	});
});

describe("webview/ideapreview matchesFilters", () => {
	const chained = chainedIds(integrationPayload.chains);

	it("shows everything when nothing is selected", () => {
		for (const c of integrationPayload.cards) {
			assert.strictEqual(matchesFilters(c, [], chained), true);
		}
	});

	it("matches each filter against the property it names", () => {
		assert.strictEqual(matchesFilters(byId("depression"), ["laws"], chained), true);
		assert.strictEqual(matchesFilters(byId("HOL_shell1"), ["laws"], chained), false);

		assert.strictEqual(matchesFilters(byId("depression"), ["default"], chained), true);
		assert.strictEqual(matchesFilters(byId("HOL_shell1"), ["research"], chained), true);
		assert.strictEqual(
			matchesFilters(byId("political_power_bonus"), ["modifiers"], chained),
			true,
		);
		assert.strictEqual(matchesFilters(byId("depression"), ["conditions"], chained), true);
		assert.strictEqual(
			matchesFilters(byId("political_power_bonus"), ["chains"], chained),
			true,
		);
		assert.strictEqual(matchesFilters(byId("HOL_shell1"), ["chains"], chained), false);
	});

	// Each entry answers the same question -- which ideas belong in the roster -- so several widen
	// rather than narrow each other.
	it("treats several selected filters as an OR", () => {
		const selection: IdeaFilter[] = ["laws", "research"];
		assert.strictEqual(matchesFilters(byId("depression"), selection, chained), true);
		assert.strictEqual(matchesFilters(byId("HOL_shell1"), selection, chained), true);
		assert.strictEqual(matchesFilters(byId("HOL_shell3a"), selection, chained), false);
	});
});

describe("webview/ideapreview matchesQuery", () => {
	it("matches the key, the localised name and the category", () => {
		assert.strictEqual(matchesQuery(byId("HOL_shell1"), "hol_shell"), true);
		assert.strictEqual(matchesQuery(byId("HOL_shell1"), "royal"), true);
		assert.strictEqual(matchesQuery(byId("HOL_shell1"), "country"), true);
	});

	// "which ideas touch stability" is the question the roster is most often opened to answer.
	it("matches a modifier by its token and by its shown name", () => {
		assert.strictEqual(matchesQuery(byId("depression"), "stability_factor"), true);
		assert.strictEqual(matchesQuery(byId("depression"), "stability"), true);
		assert.strictEqual(matchesQuery(byId("HOL_shell1"), "fuel"), true);
	});

	it("matches nothing on an empty query", () => {
		assert.strictEqual(matchesQuery(byId("HOL_shell1"), ""), false);
	});

	it("does not match an unrelated word", () => {
		assert.strictEqual(matchesQuery(byId("HOL_shell1"), "torpedo"), false);
	});
});

describe("webview/ideapreview chainsForGroups", () => {
	const visible = new Set(integrationPayload.cards.map((c) => c.id));

	it("attaches a chain to the group its first member sits in", () => {
		const byGroup = chainsForGroups(
			integrationPayload.groups,
			integrationPayload.chains,
			visible,
		);
		assert.deepStrictEqual([...byGroup.keys()], ["country"]);
		assert.strictEqual(byGroup.get("country")?.length, 1);
	});

	it("drops a chain whose every member a filter removed", () => {
		const byGroup = chainsForGroups(
			integrationPayload.groups,
			integrationPayload.chains,
			new Set(["HOL_shell1"]),
		);
		assert.strictEqual(byGroup.size, 0);
	});
});

describe("webview/ideapreview modifierLineToDom", () => {
	function lineOf(extra: Partial<ModifierLine>): HTMLDivElement {
		return modifierLineToDom({
			key: "stability_factor",
			name: "Stability",
			value: "-10%",
			tone: "bad",
			...extra,
		});
	}

	it("writes the name, the value and the tone the payload decided", () => {
		const row = lineOf({});
		assert.strictEqual(row.querySelector(".idea-mod-name")?.textContent, "Stability");
		const value = row.querySelector(".idea-mod-value");
		assert.strictEqual(value?.textContent, "-10%");
		assert.ok(value?.classList.contains("idea-mod-bad"));
	});

	it("keeps the raw token as the name's tooltip", () => {
		const name = lineOf({}).querySelector(".idea-mod-name") as HTMLElement;
		assert.strictEqual(name.title, "stability_factor");
	});

	it("carries the good and neutral tones through as well", () => {
		assert.ok(
			lineOf({ tone: "good" })
				.querySelector(".idea-mod-value")
				?.classList.contains("idea-mod-good"),
		);
		assert.ok(
			lineOf({ tone: "neutral" })
				.querySelector(".idea-mod-value")
				?.classList.contains("idea-mod-neutral"),
		);
	});
});

describe("webview/ideapreview conditionToDom", () => {
	it("renders a leaf as one line", () => {
		const list = conditionToDom({ scopeName: "", nodeContent: "original_tag = HOL" });
		assert.strictEqual(list.querySelectorAll("li").length, 1);
		assert.strictEqual(list.textContent, "original_tag = HOL");
	});

	// A one-item `and` adds nesting without adding meaning.
	it("unwraps a single-item and", () => {
		const list = conditionToDom({
			type: "and",
			items: [{ scopeName: "", nodeContent: "original_tag = HOL" }],
		});
		assert.strictEqual(list.querySelectorAll("li").length, 1);
	});

	it("names the folder so a negated group cannot read as a positive one", () => {
		const list = conditionToDom({
			type: "ornot",
			items: [
				{ scopeName: "", nodeContent: "a = 1" },
				{ scopeName: "", nodeContent: "b = 2" },
			],
		});
		assert.strictEqual(list.querySelector(".ev-fold")?.textContent, "none of");
	});
});

describe("webview/ideapreview rendering", () => {
	function content(): HTMLElement {
		const element = document.getElementById("ideapreviewcontent");
		assert.ok(element, "expected the shell content element");
		return element!;
	}

	let previousBody = "";

	before(() => {
		previousBody = document.body.innerHTML;
		document.body.innerHTML = shellHtml;
		// The module binds its renderer to window load, as the webview does.
		window.dispatchEvent(new (window as any).Event("load"));
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	it("renders a group per category and a card per idea", () => {
		assert.strictEqual(content().querySelectorAll(".idea-group").length, 2);
		// Three ideas in the file plus the chain member defined elsewhere.
		assert.strictEqual(content().querySelectorAll(".idea-card").length, 5);
	});

	// The whole point of the issue: an idea card is an event card, not something that resembles one.
	it("draws each idea on the shared card", () => {
		const card = content().querySelector(".idea-card");
		assert.ok(card);
		assert.ok(card!.classList.contains("ev-card"));
		assert.ok(card!.querySelector(".ev-head"));
		assert.ok(card!.querySelector(".ev-id"));
	});

	it("shows the idea key, and the localised name beside it", () => {
		const ids = Array.from(content().querySelectorAll(".ev-id")).map(
			(e) => e.textContent,
		);
		assert.ok(ids.includes("HOL_shell1"));

		const subs = Array.from(content().querySelectorAll(".ev-sub")).map(
			(e) => e.textContent,
		);
		assert.ok(subs.includes("Royal Shell"));
	});

	it("marks an idea that borrows another idea's name", () => {
		const borrowed = content().querySelector(".idea-borrowed") as HTMLElement | null;
		assert.ok(borrowed, "expected the borrowed-name marker");
		assert.strictEqual(borrowed!.textContent, "Renewable Shell");
	});

	it("draws the chain as a run of cards joined by arrows", () => {
		const chain = content().querySelector(".idea-chain");
		assert.ok(chain, "expected a chain row");
		assert.strictEqual(chain!.querySelectorAll(".idea-card").length, 2);
		assert.strictEqual(chain!.querySelectorAll(".idea-arrow").length, 1);
		// The member this file does not define is drawn, so the chain says where it goes.
		assert.strictEqual(chain!.querySelectorAll(".idea-card-external").length, 1);
	});

	it("makes the arrow jump to the file that performs the swap", () => {
		const arrow = content().querySelector(".idea-arrow") as HTMLElement;
		assert.ok(arrow.classList.contains("navigator"));
		assert.strictEqual(arrow.getAttribute("file"), "common/national_focus/00_generic.txt");
		assert.strictEqual(arrow.getAttribute("start"), "5");
	});

	it("makes a card jump to where the idea is written", () => {
		const card = Array.from(content().querySelectorAll(".idea-card")).find(
			(c) => c.querySelector(".ev-id")?.textContent === "HOL_shell1",
		) as HTMLElement;
		assert.ok(card.classList.contains("navigator"));
		assert.strictEqual(card.getAttribute("start"), "20");
		assert.strictEqual(card.getAttribute("file"), "common/ideas/test.txt");
	});

	it("draws the modifiers as name and value pairs", () => {
		const values = Array.from(content().querySelectorAll(".idea-mod-value")).map(
			(e) => e.textContent,
		);
		assert.ok(values.includes("-10%"));
		assert.ok(values.includes("+0.3"));
		assert.ok(values.includes("+5%"));
	});

	it("draws the icon only where there is one", () => {
		const icons = content().querySelectorAll(".idea-icon");
		assert.strictEqual(icons.length, 1);
		assert.ok(icons[0]?.classList.contains("st-idea-icon-shell"));
	});

	it("marks a law group and the idea a category starts with", () => {
		assert.strictEqual(content().querySelectorAll(".idea-group-tag").length, 1);
		assert.strictEqual(content().querySelectorAll(".idea-card-default").length, 1);
	});

	// Off by default: a description is several lines of prose on a card that is otherwise scannable.
	it("keeps descriptions out of the DOM until they are asked for", () => {
		assert.strictEqual(content().querySelectorAll(".idea-desc").length, 0);

		const toggle = document.getElementById("show-description") as HTMLInputElement;
		toggle.checked = true;
		toggle.dispatchEvent(new (window as any).Event("change"));

		assert.strictEqual(content().querySelectorAll(".idea-desc").length, 1);

		toggle.checked = false;
		toggle.dispatchEvent(new (window as any).Event("change"));
		assert.strictEqual(content().querySelectorAll(".idea-desc").length, 0);
	});

	it("drops the modifier lines entirely when the toggle is off", () => {
		const toggle = document.getElementById("show-modifiers") as HTMLInputElement;
		toggle.checked = false;
		toggle.dispatchEvent(new (window as any).Event("change"));

		assert.strictEqual(content().querySelectorAll(".idea-mod").length, 0);

		toggle.checked = true;
		toggle.dispatchEvent(new (window as any).Event("change"));
		assert.ok(content().querySelectorAll(".idea-mod").length > 0);
	});

	it("shows the idea key alone once localisation is turned off", () => {
		const toggle = document.getElementById("show-localisation") as HTMLInputElement;
		toggle.checked = false;
		toggle.dispatchEvent(new (window as any).Event("change"));

		const subs = Array.from(content().querySelectorAll(".ev-sub")).map(
			(e) => e.textContent,
		);
		assert.ok(!subs.includes("Royal Shell"));
		// The borrowed key is still worth a second line: it is not the idea's own key.
		assert.ok(subs.includes("HOL_shell2a"));

		toggle.checked = true;
		toggle.dispatchEvent(new (window as any).Event("change"));
	});

	it("highlights the cards a search matches", () => {
		const box = document.getElementById("idea-searchbox") as HTMLInputElement;
		box.value = "stability";
		box.dispatchEvent(new (window as any).Event("input"));

		assert.strictEqual(content().querySelectorAll(".ev-hit").length, 1);
		assert.strictEqual(
			document.getElementById("idea-search-count")?.textContent,
			"-/1",
		);

		box.value = "";
		box.dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual(content().querySelectorAll(".ev-hit").length, 0);
	});

	it("says so rather than showing an empty page when a filter matches nothing", () => {
		const emptyPayload: IdeaPreviewPayload = {
			...integrationPayload,
			cards: [],
			groups: [],
			chains: [],
		};
		(global as any).window.ideaPreview = emptyPayload;
		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", data: { ideaPreview: emptyPayload } },
			}),
		);

		assert.strictEqual(content().querySelectorAll(".idea-empty").length, 1);

		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", data: { ideaPreview: integrationPayload } },
			}),
		);
		assert.strictEqual(content().querySelectorAll(".idea-empty").length, 0);
	});

	it("says when the swap index is off, so a missing chain is not read as none existing", () => {
		const offPayload: IdeaPreviewPayload = {
			...integrationPayload,
			chains: [],
			toolbarFlags: {
				...integrationPayload.toolbarFlags,
				hasChains: false,
				chainsUnavailable: true,
			},
		};
		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", data: { ideaPreview: offPayload } },
			}),
		);

		assert.strictEqual(content().querySelectorAll(".idea-note").length, 1);
		assert.strictEqual(content().querySelectorAll(".idea-chain").length, 0);

		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", data: { ideaPreview: integrationPayload } },
			}),
		);
	});

	it("hides a control this file cannot use", () => {
		const gatedPayload: IdeaPreviewPayload = {
			...integrationPayload,
			toolbarFlags: { ...integrationPayload.toolbarFlags, hasIcons: false },
		};
		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", data: { ideaPreview: gatedPayload } },
			}),
		);

		const widget = document.getElementById("show-icon")
			?.nextElementSibling as HTMLElement | null;
		assert.strictEqual(widget?.style.display, "none");

		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", data: { ideaPreview: integrationPayload } },
			}),
		);
	});
});
