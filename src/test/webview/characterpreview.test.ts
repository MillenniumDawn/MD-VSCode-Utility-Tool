// The side effect matters as much as the import: ./setup installs the jsdom globals and the
// acquireVsCodeApi mock the module under test takes its handle from at import time.
import { takePostedMessages } from "./setup";
import * as assert from "assert";
import {
	CharacterCard,
	CharacterPreviewPayload,
	ModifierLine,
	TraitCard,
} from "../../previewdef/character/payload";

// characterpreview.ts reads window.characterPreview at module scope, so the payload has to exist
// before the import runs. This mirrors Millennium Dawn's AFG.txt: one character wearing three
// roles, one wearing a single role, one naming a trait nothing defines, and one whose portrait
// path does not resolve.
const massoud = "AFG_ahmed_shah_massoud";

const integrationPayload: CharacterPreviewPayload = {
	conditionExprs: [],
	toolbarFlags: {
		hasLocalisation: true,
		hasDescriptions: true,
		hasPortraits: true,
		hasSkills: true,
		hasTraitDetail: true,
		hasConditions: true,
		hasMultiRole: true,
		hasUnknownTraits: true,
		hasMissingPortraits: true,
	},
	groups: [
		{
			kind: "country_leader",
			title: "Country leaders",
			cardIds: [`${massoud}:country_leader:0`],
		},
		{
			kind: "field_marshal",
			title: "Field marshals",
			cardIds: [`${massoud}:field_marshal:0`],
		},
		{
			kind: "advisor",
			title: "Advisors",
			cardIds: [`${massoud}:advisor:0`, "AFG_typo:advisor:0", "AFG_faceless:advisor:0"],
		},
	],
	cards: [
		card(massoud, "country_leader", {
			name: { key: massoud, text: "Ahmad Shah Massoud" },
			otherRoles: ["field_marshal", "advisor"],
			badges: ["Neutral_Muslim_Brotherhood"],
			traits: [trait("guerrilla_leader", { hasDetail: false })],
			nav: { start: 20, end: 30, file: "common/characters/AFG.txt" },
		}),
		card(massoud, "field_marshal", {
			name: { key: massoud, text: "Ahmad Shah Massoud" },
			otherRoles: ["country_leader", "advisor"],
			skills: [
				{ key: "skill", name: "Skill", value: "+5", tone: "neutral" },
				{ key: "attack_skill", name: "Attack Skill", value: "+4", tone: "neutral" },
			],
			traits: [
				trait("trickster", {
					modifiers: [
						{ key: "recon_factor", name: "Recon", value: "+25%", tone: "good" },
					],
				}),
			],
		}),
		card(massoud, "advisor", {
			name: { key: massoud, text: "Ahmad Shah Massoud" },
			otherRoles: ["country_leader", "field_marshal"],
			badges: ["army_chief", "ahmed_shah_massoud", "Cost 100"],
			traits: [
				trait("army_chief_planning_3", {
					modifiers: [
						{
							key: "planning_speed",
							name: "Planning Speed",
							value: "+15%",
							tone: "good",
						},
					],
					groups: [
						{
							title: "Skill bonuses",
							lines: [
								{
									key: "planning_skill",
									name: "Planning Skill",
									value: "+1",
									tone: "neutral",
								},
							],
						},
					],
					nav: { start: 8, end: 30, file: "common/country_leader/01_army.txt" },
				}),
			],
		}),
		card("AFG_typo", "advisor", {
			traits: [trait("army_chief_planing_3", { known: false, hasDetail: false })],
			hasUnknownTrait: true,
		}),
		card("AFG_faceless", "advisor", {
			portrait: undefined,
			portraitPath: "gfx/leaders/AFG/Missing.dds",
			portraitMissing: true,
			available: { scopeName: "", nodeContent: "has_war = no" },
		}),
	],
};

function trait(id: string, extra: Partial<TraitCard> = {}): TraitCard {
	return {
		id,
		name: { key: id, text: id },
		desc: { key: `${id}_desc`, text: `${id}_desc` },
		known: true,
		traitType: undefined,
		modifiers: [],
		groups: [],
		hasDetail: true,
		nav: undefined,
		...extra,
	};
}

function card(
	characterId: string,
	roleKind: CharacterCard["roleKind"],
	extra: Partial<CharacterCard> = {},
): CharacterCard {
	return {
		cardId: `${characterId}:${roleKind}:0`,
		characterId,
		roleKind,
		name: { key: characterId, text: characterId },
		desc: { key: `${characterId}_desc`, text: `${characterId}_desc` },
		portrait: { styleKey: "st-char-portrait-x", width: 156, height: 210 },
		portraitPath: "gfx/leaders/AFG/X.dds",
		portraitMissing: false,
		otherRoles: [],
		badges: [],
		skills: [],
		traits: [],
		hasUnknownTrait: false,
		modifiers: [],
		research: [],
		allowed: true,
		available: true,
		visible: true,
		hasEffects: false,
		nav: undefined,
		...extra,
	};
}

(global as any).window.characterPreview = integrationPayload;

// The shell the host renders. Installed from the rendering suite's before hook rather than at
// module scope: every webview test file shares one jsdom document, and writing body.innerHTML here
// would clobber whichever other file's fixture happened to load after this one.
const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <input type="checkbox" id="show-localisation">
        <input type="checkbox" id="show-portrait">
        <input type="checkbox" id="show-skills">
        <input type="checkbox" id="expand-traits">
        <input type="checkbox" id="show-description">
        <input type="checkbox" id="show-conditions">
        <div id="character-filter-container">
            <div class="select-container">
                <div id="character-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    <div class="option" value="multirole">Has several roles</div>
                    <div class="option" value="unknowntrait">Has unknown trait</div>
                    <div class="option" value="noportrait">Portrait not found</div>
                    <div class="option" value="traits">Has traits</div>
                    <div class="option" value="conditions">Has conditions</div>
                </div>
            </div>
        </div>
        <input type="text" id="character-searchbox">
        <span id="character-search-count"></span>
    </div></div>
    <div id="characterpreviewcontent"></div>`;

const characterpreview =
	require("../../../webviewsrc/characterpreview") as typeof import("../../../webviewsrc/characterpreview");
const { readFilters, matchesFilters, matchesQuery, modifierLineToDom, traitToDom } =
	characterpreview;

function byId(cardId: string): CharacterCard {
	const found = integrationPayload.cards.find((c) => c.cardId === cardId);
	assert.ok(found, `expected a card for ${cardId}`);
	return found!;
}

describe("webview/characterpreview readFilters", () => {
	it("keeps only known values, in the toolbar's order", () => {
		assert.deepStrictEqual(readFilters(["conditions", "multirole", "nonsense"]), [
			"multirole",
			"conditions",
		]);
	});

	it("reads anything that is not a list as no selection at all", () => {
		assert.deepStrictEqual(readFilters(undefined), []);
		assert.deepStrictEqual(readFilters("multirole"), []);
		assert.deepStrictEqual(readFilters(null), []);
	});
});

describe("webview/characterpreview matchesFilters", () => {
	it("shows everything when nothing is selected", () => {
		for (const c of integrationPayload.cards) {
			assert.strictEqual(matchesFilters(c, []), true);
		}
	});

	it("matches each filter against the property it names", () => {
		assert.strictEqual(matchesFilters(byId(`${massoud}:advisor:0`), ["multirole"]), true);
		assert.strictEqual(matchesFilters(byId("AFG_typo:advisor:0"), ["multirole"]), false);

		assert.strictEqual(matchesFilters(byId("AFG_typo:advisor:0"), ["unknowntrait"]), true);
		assert.strictEqual(
			matchesFilters(byId(`${massoud}:advisor:0`), ["unknowntrait"]),
			false,
		);

		assert.strictEqual(matchesFilters(byId("AFG_faceless:advisor:0"), ["noportrait"]), true);
		assert.strictEqual(matchesFilters(byId("AFG_faceless:advisor:0"), ["conditions"]), true);
		assert.strictEqual(matchesFilters(byId(`${massoud}:advisor:0`), ["traits"]), true);
		assert.strictEqual(matchesFilters(byId("AFG_faceless:advisor:0"), ["traits"]), false);
	});

	// Each entry answers the same question -- which characters belong in the roster -- so several
	// widen rather than narrow each other.
	it("treats several selected filters as an or", () => {
		assert.strictEqual(
			matchesFilters(byId("AFG_typo:advisor:0"), ["multirole", "unknowntrait"]),
			true,
		);
	});
});

describe("webview/characterpreview matchesQuery", () => {
	it("never matches on an empty query", () => {
		assert.strictEqual(matchesQuery(byId(`${massoud}:advisor:0`), ""), false);
	});

	it("matches the character id and the localised name", () => {
		assert.strictEqual(matchesQuery(byId(`${massoud}:advisor:0`), "massoud"), true);
		assert.strictEqual(matchesQuery(byId(`${massoud}:advisor:0`), "ahmad shah"), true);
	});

	// The advisor slot and the idea token ride in the badges, and they are what a reader hunting
	// for "every army chief in this file" actually types.
	it("matches a badge", () => {
		assert.strictEqual(matchesQuery(byId(`${massoud}:advisor:0`), "army_chief"), true);
		assert.strictEqual(matchesQuery(byId(`${massoud}:country_leader:0`), "muslim"), true);
	});

	it("matches a trait by its id", () => {
		assert.strictEqual(matchesQuery(byId(`${massoud}:field_marshal:0`), "trickster"), true);
	});

	// The whole point of resolving the traits: a modifier a character grants is findable even
	// though the character file never mentions it.
	it("matches a modifier a trait grants, by token and by name", () => {
		assert.strictEqual(
			matchesQuery(byId(`${massoud}:field_marshal:0`), "recon_factor"),
			true,
		);
		assert.strictEqual(matchesQuery(byId(`${massoud}:advisor:0`), "planning speed"), true);
	});

	it("matches a modifier inside a trait's group", () => {
		assert.strictEqual(matchesQuery(byId(`${massoud}:advisor:0`), "planning_skill"), true);
	});

	it("does not match a character that has nothing to do with the query", () => {
		assert.strictEqual(matchesQuery(byId("AFG_faceless:advisor:0"), "trickster"), false);
	});
});

describe("webview/characterpreview modifierLineToDom", () => {
	function lineOf(extra: Partial<ModifierLine>): HTMLDivElement {
		return modifierLineToDom({
			key: "recon_factor",
			name: "Recon",
			value: "+25%",
			tone: "good",
			...extra,
		});
	}

	it("writes the name, the value and the tone the payload decided", () => {
		const row = lineOf({});
		assert.strictEqual(row.querySelector(".char-mod-name")?.textContent, "Recon");
		const value = row.querySelector(".char-mod-value");
		assert.strictEqual(value?.textContent, "+25%");
		assert.ok(value?.classList.contains("char-mod-good"));
	});

	it("keeps the raw token as the name's tooltip", () => {
		const name = lineOf({}).querySelector(".char-mod-name") as HTMLElement;
		assert.strictEqual(name.title, "recon_factor");
	});

	it("carries the bad and neutral tones through as well", () => {
		assert.ok(
			lineOf({ tone: "bad" })
				.querySelector(".char-mod-value")
				?.classList.contains("char-mod-bad"),
		);
		assert.ok(
			lineOf({ tone: "neutral" })
				.querySelector(".char-mod-value")
				?.classList.contains("char-mod-neutral"),
		);
	});
});

describe("webview/characterpreview traitToDom", () => {
	it("starts closed and opens on a click", () => {
		const box = traitToDom(
			trait("trickster", {
				modifiers: [{ key: "recon_factor", name: "Recon", value: "+25%", tone: "good" }],
			}),
		);
		const pill = box.querySelector(".char-trait") as HTMLElement;
		const detail = box.querySelector(".char-trait-mods") as HTMLElement;

		assert.strictEqual(pill.getAttribute("aria-expanded"), "false");
		assert.strictEqual(detail.hidden, true);

		pill.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));

		assert.strictEqual(pill.getAttribute("aria-expanded"), "true");
		assert.strictEqual(detail.hidden, false);
		assert.strictEqual(detail.querySelector(".char-mod-name")?.textContent, "Recon");
	});

	it("closes again on a second click", () => {
		const box = traitToDom(trait("trickster"));
		const pill = box.querySelector(".char-trait") as HTMLElement;
		const detail = box.querySelector(".char-trait-mods") as HTMLElement;

		pill.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
		pill.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));

		assert.strictEqual(detail.hidden, true);
		assert.strictEqual(pill.getAttribute("aria-expanded"), "false");
	});

	it("draws a trait's named groups under it", () => {
		const box = traitToDom(
			trait("army_chief_planning_3", {
				groups: [
					{
						title: "Skill bonuses",
						lines: [
							{ key: "planning_skill", name: "Planning", value: "+1", tone: "neutral" },
						],
					},
				],
			}),
		);

		assert.strictEqual(
			box.querySelector(".char-mods-head")?.textContent,
			"Skill bonuses",
		);
	});

	it("says so when a known trait grants nothing the preview can read", () => {
		const box = traitToDom(trait("guerrilla_leader", { hasDetail: false }));
		assert.ok(box.querySelector(".char-trait-note"));
	});

	// The single most useful thing this preview says: nothing defines the trait, which in a
	// hand-written character is almost always a typo.
	it("marks a trait nothing defines and gives it nothing to open", () => {
		const box = traitToDom(trait("army_chief_planing_3", { known: false }));
		const pill = box.querySelector(".char-trait") as HTMLElement;

		assert.ok(pill.classList.contains("char-trait-unknown"));
		assert.strictEqual(box.querySelector(".char-trait-mods"), null);
		assert.ok(pill.title.includes("army_chief_planing_3"));
	});

	it("makes a trait pill jump to where the trait is defined", () => {
		const box = traitToDom(
			trait("army_chief_planning_3", {
				nav: { start: 8, end: 30, file: "common/country_leader/01_army.txt" },
			}),
		);
		const pill = box.querySelector(".char-trait") as HTMLElement;

		assert.ok(pill.classList.contains("navigator"));
		assert.strictEqual(pill.getAttribute("file"), "common/country_leader/01_army.txt");
		assert.strictEqual(pill.getAttribute("start"), "8");
	});
});

describe("webview/characterpreview rendering", () => {
	function content(): HTMLElement {
		const element = document.getElementById("characterpreviewcontent");
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

	it("renders a group per role and a card per role a character wears", () => {
		assert.strictEqual(content().querySelectorAll(".char-group").length, 3);
		assert.strictEqual(content().querySelectorAll(".char-card").length, 5);
	});

	it("names each group and counts what is in it", () => {
		const names = Array.from(content().querySelectorAll(".char-group-name")).map(
			(e) => e.textContent,
		);
		assert.deepStrictEqual(names, ["Country leaders", "Field marshals", "Advisors"]);

		const counts = Array.from(content().querySelectorAll(".char-group-count")).map(
			(e) => e.textContent,
		);
		assert.deepStrictEqual(counts, [
			"1 character(s)",
			"1 character(s)",
			"3 character(s)",
		]);
	});

	// A character card is an idea card is an event card, not something that resembles one.
	it("draws each character on the shared card", () => {
		const card = content().querySelector(".char-card");
		assert.ok(card);
		assert.ok(card!.classList.contains("ev-card"));
		assert.ok(card!.querySelector(".ev-head"));
		assert.ok(card!.querySelector(".ev-id"));
	});

	it("shows the character id, and the localised name beside it", () => {
		const ids = Array.from(content().querySelectorAll(".ev-id")).map((e) => e.textContent);
		assert.ok(ids.includes(massoud));

		const subs = Array.from(content().querySelectorAll(".ev-sub")).map(
			(e) => e.textContent,
		);
		assert.ok(subs.includes("Ahmad Shah Massoud"));
	});

	it("draws the portrait the payload resolved", () => {
		const portrait = content().querySelector(".char-portrait") as HTMLElement;
		assert.ok(portrait.classList.contains("st-char-portrait-x"));
		assert.strictEqual(portrait.title, "gfx/leaders/AFG/X.dds");
	});

	// A broken portrait path is exactly what the author needs to see, so it is drawn rather than
	// left as an empty gap.
	it("marks a portrait that was written down and did not resolve", () => {
		const missing = content().querySelector(".char-portrait-missing") as HTMLElement;
		assert.ok(missing, "expected a placeholder for the unresolved portrait");
		assert.ok(missing.title.includes("gfx/leaders/AFG/Missing.dds"));
	});

	// How a multi-role character is recognised from inside a single group.
	it("says on each card where else the same character appears", () => {
		const badge = content().querySelector(".char-badge-roles");
		assert.ok(badge);
		assert.strictEqual(badge!.textContent, "Also: field_marshal, advisor");
	});

	it("marks the card whose trait nothing defines", () => {
		assert.strictEqual(content().querySelectorAll(".char-card-warn").length, 1);
		assert.strictEqual(content().querySelectorAll(".char-trait-unknown").length, 1);
	});

	it("draws the skills", () => {
		const skills = content().querySelector(".char-skills");
		assert.ok(skills);
		assert.strictEqual(skills!.querySelectorAll(".char-mod").length, 2);
	});

	it("makes a card jump to where the character is written", () => {
		const card = Array.from(content().querySelectorAll(".char-card")).find((c) =>
			c.classList.contains("navigator"),
		) as HTMLElement;
		assert.ok(card);
		assert.strictEqual(card.getAttribute("start"), "20");
		assert.strictEqual(card.getAttribute("file"), "common/characters/AFG.txt");
	});

	it("keeps every trait one click away rather than expanded", () => {
		const details = content().querySelectorAll(".char-trait-mods");
		assert.ok(details.length > 0);
		for (const detail of Array.from(details)) {
			assert.strictEqual((detail as HTMLElement).hidden, true);
		}
	});

	// These run against the roster as it is actually wired -- built, then handed to
	// subscribeNavigators -- because that second listener is the whole problem. A trait pill with a
	// nav target carries two click listeners: its own, and the navigator's. Nothing traitToDom is
	// tested with on its own can see that.
	describe("a trait pill that is also a navigator", () => {
		function navigablePill(): { pill: HTMLElement; detail: HTMLElement } {
			const box = Array.from(content().querySelectorAll(".char-trait-box")).find(
				(b) => b.querySelector(".char-trait.navigator"),
			);
			assert.ok(box, "expected a trait pill carrying a nav target");
			return {
				pill: box!.querySelector(".char-trait") as HTMLElement,
				detail: box!.querySelector(".char-trait-mods") as HTMLElement,
			};
		}

		beforeEach(() => {
			takePostedMessages();
		});

		it("expands on a plain click and does not also open the trait's file", () => {
			const { pill, detail } = navigablePill();
			const wasHidden = detail.hidden;

			pill.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));

			assert.strictEqual(detail.hidden, !wasHidden);
			assert.deepStrictEqual(
				takePostedMessages().filter((m) => m.command === "navigate"),
				[],
			);
		});

		it("opens the trait's file on a ctrl-click, and leaves it closed", () => {
			const { pill, detail } = navigablePill();
			const wasHidden = detail.hidden;

			pill.dispatchEvent(
				new (window as any).MouseEvent("click", { bubbles: true, ctrlKey: true }),
			);

			assert.strictEqual(detail.hidden, wasHidden);
			// Every webview module imported into this test process wires its own navigators over the
			// shared document, so the count is a property of the harness rather than of the preview.
			// What the pill owes the reader is that a ctrl-click reaches the trait, and reaches
			// nothing else.
			const navigations = takePostedMessages().filter((m) => m.command === "navigate");
			assert.ok(navigations.length > 0);
			for (const navigation of navigations) {
				assert.strictEqual(navigation.file, "common/country_leader/01_army.txt");
				assert.strictEqual(navigation.start, 8);
			}
		});

		it("does not carry the click up to the card underneath", () => {
			const { pill } = navigablePill();

			pill.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));

			assert.deepStrictEqual(
				takePostedMessages().filter((m) => m.command === "navigate"),
				[],
			);
		});
	});
});
