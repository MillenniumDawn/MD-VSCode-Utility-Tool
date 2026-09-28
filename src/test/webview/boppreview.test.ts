import { loadEntrypoint, useEntrypoint, takePostedMessages } from "./setup";
import * as assert from "assert";
import { BopPreviewPayload, BopRangeView } from "../../previewdef/bop/payload";

function range(id: string, min: number, max: number, extra: Partial<BopRangeView> = {}): BopRangeView {
	return { id, name: { key: id, text: id }, min, max, ...extra };
}

// What the host draws for powerbalanceview, cut down to the slots the webview fills: the four
// progress bars, the ticks layer, the needle and the two texts.
const windowHtml = `<div class="bop-gui-window" style="width:550px;height:600px"><div>
	<div class="bop-slot-text bop-slot-text-title_350"></div>
	<div class="bop-slot-title"></div>
	<div class="bop-slot-active-range" start="10" end="20" file="interface/powerbalanceview.gui"></div>
	<div class="bop-slot-value">
		<div class="bop-slot-fill bop-slot-fill-left"></div>
		<div class="bop-slot-fill bop-slot-fill-right"></div>
		<div class="bop-slot-fill bop-slot-fill-left-moving"></div>
		<div class="bop-slot-fill bop-slot-fill-right-moving"></div>
	</div>
	<div class="bop-slot-marks"></div>
	<div class="bop-slot-needle"><div class="needle-sprite"></div></div>
</div></div>`;

// Millennium Dawn's Romanian BoP, with localisation.
const payload: BopPreviewPayload = {
	hasLocalisation: true,
	cards: [
		{
			key: "vadim_people_balance",
			id: "vadim_people_balance",
			title: { key: "vadim_people_balance", text: "Vadim's Struggle" },
			initialValue: 0.25,
			ranges: [
				range("vadim_unlimited", -1, -0.1, {
					name: { key: "vadim_unlimited", text: "Vadim Holds Unlimited Power" },
				}),
				range("vadim_mid_range", -0.1, 0.1, { name: { key: "vadim_mid_range", text: "Balanced" } }),
				range("people_dominant", 0.1, 1, { nav: { start: 100, end: 115, file: "common/bop/ROM.txt" } }),
			],
			window: {
				html: windowHtml,
				width: 550,
				height: 600,
				bar: { x: 95, y: 125, width: 360 },
				texts: [
					{ id: "title#0", text: { key: "balance_of_power_title", text: "Balance of Power" } },
				],
				splitterHtml: `<div class="splitter-sprite"></div>`,
				indicatorHtml: [`<div class="indicator-0"></div>`, `<div class="indicator-1"></div>`],
			},
			warnings: ["Icon x of side people_right_side was not found."],
		},
		// A second BoP in the same file, whose window could not be found.
		{
			key: "rom_second",
			id: "rom_second",
			title: { key: "rom_second", text: "Second Balance" },
			initialValue: -0.5,
			ranges: [range("second_all", -1, 1, { name: { key: "second_all", text: "Everything" } })],
			warnings: ["The powerbalanceview window was not found."],
		},
	],
};

(global as any).window.bopPreview = payload;

// The toolbar as renderBopFile writes it.
const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <div id="bop-select-container"><select id="bops"></select></div>
        <div class="bop-controls">
            <button class="bop-step" data-step="-0.1">-0.1</button>
            <button class="bop-step" data-step="-0.05">-0.05</button>
            <input type="range" id="bop-slider" class="bop-slider" min="-1" max="1" step="0.01">
            <button class="bop-step" data-step="0.05">+0.05</button>
            <button class="bop-step" data-step="0.1">+0.1</button>
            <input type="number" id="bop-number" class="bop-number" min="-1" max="1" step="0.01">
            <button id="bop-reset" class="bop-reset">Reset</button>
        </div>
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
		const element = document.querySelector("#boppreviewcontent");
		assert.ok(element, "expected the content");
		return element as HTMLElement;
	}

	function input(id: string): HTMLInputElement {
		return document.getElementById(id) as HTMLInputElement;
	}

	function slot(name: string): HTMLElement {
		const element = card().querySelector(".bop-slot-" + name);
		assert.ok(element, "expected slot " + name);
		return element as HTMLElement;
	}

	function shownFill(): string | undefined {
		const fill = card().querySelector(".bop-slot-fill.bop-shown");
		return fill ? Array.from(fill.classList).find((c) => c.startsWith("bop-slot-fill-")) : undefined;
	}

	function slide(value: string): void {
		const slider = input("bop-slider");
		slider.value = value;
		slider.dispatchEvent(new (window as any).Event("input"));
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

	it("offers every BoP of the file in the toolbar dropdown", () => {
		const options = Array.from(document.querySelectorAll("#bops option")).map((o) => o.textContent);
		assert.deepStrictEqual(options, ["(vadim_people_balance) Vadim's Struggle", "(rom_second) Second Balance"]);
		assert.strictEqual((document.getElementById("bop-select-container") as HTMLElement).style.display, "block");
	});

	it("puts the localised title in the window and shows the warning", () => {
		assert.strictEqual(slot("title").textContent, "Vadim's Struggle");
		assert.strictEqual(card().querySelectorAll(".bop-warning").length, 1);
		// Under the window, not above it.
		assert.strictEqual(card().lastElementChild?.className, "bop-warning");
		assert.strictEqual(card().querySelector(".bop-slot-text-title_350")?.textContent, "Balance of Power");
	});

	it("shows the keys, the window's own texts included, with the localisation toggle off", () => {
		const toggle = input("show-localisation");
		toggle.checked = false;
		toggle.dispatchEvent(new (window as any).Event("change"));
		assert.strictEqual(card().querySelector(".bop-slot-text-title_350")?.textContent, "balance_of_power_title");
		assert.strictEqual(slot("title").textContent, "vadim_people_balance");
		toggle.checked = true;
		toggle.dispatchEvent(new (window as any).Event("change"));
		assert.strictEqual(slot("title").textContent, "Vadim's Struggle");
	});

	it("puts a tick on every inner range boundary", () => {
		const marks = Array.from(slot("marks").children) as HTMLElement[];
		assert.deepStrictEqual(
			marks.map((m) => m.style.transform),
			["translate(257px, 125px)", "translate(293px, 125px)"],
		);
		assert.ok(marks.every((m) => m.querySelector(".splitter-sprite")));
	});

	it("starts at initial_value: needle, static fill and active range", () => {
		assert.strictEqual(input("bop-slider").value, "0.25");
		assert.strictEqual(slot("needle").style.transform, "translate(320px, 125px)");
		assert.strictEqual(shownFill(), "bop-slot-fill-right");
		assert.strictEqual((card().querySelector(".bop-slot-fill-right") as HTMLElement).style.clipPath, "inset(0 37.5% 0 50%)");
		assert.strictEqual(slot("active-range").textContent, "people_dominant");
		// The lit indicator is on the edge of the active range, the other one is not.
		const marks = Array.from(slot("marks").children);
		assert.ok(marks[1].querySelector(".bop-mark-indicator-1.bop-shown"));
		assert.ok(marks[0].querySelector(".bop-mark-indicator-0.bop-shown"));
	});

	it("moves the needle, the fill and the active range with the slider", () => {
		slide("-0.5");
		assert.strictEqual(slot("active-range").textContent, "Vadim Holds Unlimited Power");
		assert.strictEqual(slot("needle").style.transform, "translate(185px, 125px)");
		assert.strictEqual(shownFill(), "bop-slot-fill-left-moving");
		assert.strictEqual((card().querySelector(".bop-slot-fill-left") as HTMLElement).style.clipPath, "inset(0 50% 0 25%)");

		// Moving back towards the centre is not moving towards the left side.
		slide("-0.3");
		assert.strictEqual(shownFill(), "bop-slot-fill-left");

		slide("0");
		assert.strictEqual(slot("active-range").textContent, "Balanced");
		assert.strictEqual(shownFill(), undefined);
	});

	it("steps the value with the buttons and stops at the end of the bar", () => {
		const number = input("bop-number");
		number.value = "0.95";
		number.dispatchEvent(new (window as any).Event("change"));
		const plus = Array.from(document.querySelectorAll(".bop-step")).find((b) => b.textContent === "+0.1") as HTMLElement;
		plus.click();
		assert.strictEqual(number.value, "1");
		assert.strictEqual(shownFill(), "bop-slot-fill-right-moving");
		plus.click();
		assert.strictEqual(number.value, "1");
	});

	it("puts the value back at initial_value on reset, without the moving arrow", () => {
		(document.getElementById("bop-reset") as HTMLElement).click();
		assert.strictEqual(input("bop-number").value, "0.25");
		assert.strictEqual(shownFill(), "bop-slot-fill-right");
	});

	it("opens the range a tick marks, the one past it away from the centre", () => {
		takePostedMessages();
		const marks = Array.from(slot("marks").children) as HTMLElement[];
		(marks[1].querySelector(".splitter-sprite") as HTMLElement).click();
		const posted = takePostedMessages();
		assert.deepStrictEqual(
			posted.filter((m) => m.command === "navigate").map((m) => [m.start, m.end, m.file]),
			[[100, 115, "common/bop/ROM.txt"]],
		);
	});

	it("opens the active range's definition when its name is clicked", () => {
		takePostedMessages();
		slot("active-range").click();
		const posted = takePostedMessages();
		assert.deepStrictEqual(
			posted.filter((m) => m.command === "navigate").map((m) => [m.start, m.end, m.file]),
			[[100, 115, "common/bop/ROM.txt"]],
		);
	});

	it("switches to another BoP from the dropdown, each keeping its own value", () => {
		slide("0.6");
		const select = document.getElementById("bops") as HTMLSelectElement;
		select.value = "rom_second";
		select.dispatchEvent(new (window as any).Event("change"));
		assert.strictEqual(input("bop-number").value, "-0.5");
		assert.strictEqual(card().querySelector(".bop-gui-frame"), null);
		assert.strictEqual(card().querySelector(".bop-none")?.textContent, "Everything");

		select.value = "vadim_people_balance";
		select.dispatchEvent(new (window as any).Event("change"));
		assert.strictEqual(input("bop-number").value, "0.6");
	});
});
