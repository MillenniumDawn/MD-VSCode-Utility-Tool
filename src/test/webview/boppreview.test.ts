import { loadEntrypoint, useEntrypoint, takePostedMessages } from "./setup";
import * as assert from "assert";
import { BopPreviewPayload, BopRangeView } from "../../previewdef/bop/payload";

function range(id: string, min: number, max: number, extra: Partial<BopRangeView> = {}): BopRangeView {
	return {
		id,
		name: { key: id, text: id },
		min,
		max,
		side: max <= 0 ? "left" : min >= 0 ? "right" : "centre",
		modifiers: [],
		tooltips: [],
		hasOnActivate: false,
		hasOnDeactivate: false,
		...extra,
	};
}

// Millennium Dawn's Romanian BoP, with localisation.
const payload: BopPreviewPayload = {
	hasLocalisation: true,
	cards: [
		{
			key: "vadim_people_balance",
			id: "vadim_people_balance",
			title: { key: "vadim_people_balance", text: "Vadim's Struggle" },
			category: { key: "ROM_vadim_struggle", text: "Vadim's Gamble" },
			initialValue: 0.25,
			left: {
				id: "vadim_left_side",
				name: { key: "vadim_left_side", text: "Vadim" },
				iconName: "GFX_bop_ROM_vadim",
				icon: { styleKey: "st-bop-icon-vadim", width: 64, height: 64 },
			},
			right: {
				id: "people_right_side",
				name: { key: "people_right_side", text: "The People" },
				iconName: "x",
			},
			ranges: [
				range("vadim_unlimited", -1, -0.1, {
					name: { key: "vadim_unlimited", text: "Vadim Holds Unlimited Power" },
					modifiers: [{ key: "political_power_gain", name: "Political Power Gain", value: "+0.25", tone: "good" }],
					hasOnActivate: true,
				}),
				range("vadim_mid_range", -0.1, 0.1, { name: { key: "vadim_mid_range", text: "Balanced" } }),
				range("people_dominant", 0.1, 1, {
					modifiers: [{ key: "stability_factor", name: "Stability", value: "+10%", tone: "good" }],
					tooltips: [{ key: "people_tt", text: "The people rule." }],
					nav: { start: 100, end: 115, file: "common/bop/ROM.txt" },
				}),
			],
			extraSides: [],
			warnings: ["Icon x of side people_right_side was not found."],
			nav: { start: 1, end: 21, file: "common/bop/ROM.txt" },
		},
	],
};

(global as any).window.bopPreview = payload;

const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <input type="checkbox" id="show-localisation">
    </div></div>
    <div id="boppreviewcontent"></div>`;

const { module: boppreview, listeners } = loadEntrypoint(
	() => require("../../../webviewsrc/boppreview") as typeof import("../../../webviewsrc/boppreview"),
);

describe("webview/boppreview clampValue", () => {
	it("keeps the value on the bar and rounds away float noise", () => {
		assert.strictEqual(boppreview.clampValue(1.3), 1);
		assert.strictEqual(boppreview.clampValue(-4), -1);
		assert.strictEqual(boppreview.clampValue(0.1 + 0.2), 0.3);
		assert.strictEqual(boppreview.clampValue(NaN), 0);
	});
});

describe("webview/boppreview rendering", () => {
	useEntrypoint(listeners);

	function card(): HTMLElement {
		const element = document.querySelector("#boppreviewcontent .bop-card");
		assert.ok(element, "expected a BoP card");
		return element as HTMLElement;
	}

	function activeName(): string | null | undefined {
		return card().querySelector(".bop-active .bop-range-name")?.textContent;
	}

	let previousBody = "";

	before(() => {
		previousBody = document.body.innerHTML;
		document.body.innerHTML = shellHtml;
		window.dispatchEvent(new (window as any).Event("load"));
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	it("draws the localised title, both sides, the category and the warning", () => {
		assert.strictEqual(card().querySelector(".bop-title")?.textContent, "Vadim's Struggle");
		const sides = Array.from(card().querySelectorAll(".bop-side-name")).map((e) => e.textContent);
		assert.deepStrictEqual(sides, ["Vadim", "The People"]);
		assert.ok(card().querySelector(".bop-icon.st-bop-icon-vadim"));
		assert.ok(card().querySelector(".bop-side-right .bop-icon-missing"));
		assert.strictEqual(card().querySelector(".ev-badge")?.textContent, "Vadim's Gamble");
		assert.strictEqual(card().querySelectorAll(".bop-warning").length, 1);
	});

	it("draws one segment per range, placed along the bar", () => {
		const segments = Array.from(card().querySelectorAll(".bop-segment")) as HTMLElement[];
		assert.strictEqual(segments.length, 3);
		assert.strictEqual(segments[0].style.left, "0%");
		assert.strictEqual(segments[1].style.left, "45%");
		assert.ok(segments[2].classList.contains("bop-segment-right"));
	});

	it("starts at initial_value, with its range active and its modifiers shown", () => {
		const slider = card().querySelector(".bop-slider") as HTMLInputElement;
		assert.strictEqual(slider.value, "0.25");
		assert.strictEqual(activeName(), "people_dominant");
		const mods = Array.from(card().querySelectorAll(".bop-active .bop-mod-name")).map((e) => e.textContent);
		assert.deepStrictEqual(mods, ["Stability"]);
		assert.strictEqual(card().querySelector(".bop-active .bop-tooltip")?.textContent, "The people rule.");
		assert.ok(card().querySelectorAll(".bop-segment")[2].classList.contains("bop-segment-active"));
	});

	it("moves the active range with the slider", () => {
		const slider = card().querySelector(".bop-slider") as HTMLInputElement;
		slider.value = "-0.5";
		slider.dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual(activeName(), "Vadim Holds Unlimited Power");
		assert.ok(card().querySelector(".bop-active .ev-badge"), "expected the on_activate badge");
		assert.strictEqual((card().querySelector(".bop-needle") as HTMLElement).style.left, "25%");

		slider.value = "0";
		slider.dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual(activeName(), "Balanced");
	});

	it("steps the value with the buttons and stops at the end of the bar", () => {
		const number = card().querySelector(".bop-number") as HTMLInputElement;
		number.value = "0.95";
		number.dispatchEvent(new (window as any).Event("change"));
		const plus = Array.from(card().querySelectorAll(".bop-step")).find((b) => b.textContent === "+0.1") as HTMLElement;
		plus.click();
		assert.strictEqual(number.value, "1");
		plus.click();
		assert.strictEqual(number.value, "1");
	});

	it("puts the value back at initial_value on reset", () => {
		(card().querySelector(".bop-reset") as HTMLElement).click();
		assert.strictEqual((card().querySelector(".bop-number") as HTMLInputElement).value, "0.25");
	});

	it("opens a range's definition when its segment is clicked", () => {
		takePostedMessages();
		(card().querySelectorAll(".bop-segment")[2] as HTMLElement).click();
		const posted = takePostedMessages();
		assert.deepStrictEqual(
			posted.filter((m) => m.command === "navigate").map((m) => [m.start, m.end, m.file]),
			[[100, 115, "common/bop/ROM.txt"]],
		);
	});
});
