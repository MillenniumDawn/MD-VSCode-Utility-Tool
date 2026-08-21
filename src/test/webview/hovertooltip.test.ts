import "./setup";
import * as assert from "assert";
import {
	EffectTooltipOptions,
	clampBelowToolbar,
	wireEffectTooltip,
} from "../../../webviewsrc/util/hovertooltip";

const options: EffectTooltipOptions = {
	className: "test-effects-tip",
	toolbarHeight: 52,
	gap: 8,
	margin: 4,
};

const sections = [
	{
		head: "Immediate effects",
		effects: [{ kind: "line" as const, scopeName: "", content: "add_political_power = 50" }],
	},
];

// The panel waits out a hover delay before it appears, so the tests that drive it have to wait too.
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hoverDelay = 150;

describe("webview/util/hovertooltip", () => {
	let previousBody = "";
	let host: HTMLDivElement;

	before(() => {
		previousBody = document.body.innerHTML;
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	beforeEach(() => {
		document.body.innerHTML = "";
		host = document.createElement("div");
		document.body.appendChild(host);
	});

	const panels = () => document.querySelectorAll("." + options.className);
	const enter = () => host.dispatchEvent(new (window as any).Event("mouseenter"));
	const leave = () => host.dispatchEvent(new (window as any).Event("mouseleave"));

	it("keeps the panel closed until the hover has been held", async () => {
		wireEffectTooltip(host, sections, options);

		enter();
		assert.strictEqual(panels().length, 0);

		await wait(hoverDelay + 30);
		assert.strictEqual(panels().length, 1);
	});

	it("typesets the panel like a condition panel and heads each block", async () => {
		wireEffectTooltip(host, sections, options);
		enter();
		await wait(hoverDelay + 30);

		const panel = panels()[0]!;
		assert.ok(panel.classList.contains("ev-cond"));
		assert.strictEqual(panel.querySelector(".ev-cond-head")?.textContent, "Immediate effects");
		assert.ok(panel.textContent?.includes("add_political_power = 50"));
		// Placed before it is shown, so it never flashes at the top left of the window.
		assert.strictEqual((panel as HTMLDivElement).style.visibility, "");
	});

	it("takes the panel away when the pointer leaves", async () => {
		wireEffectTooltip(host, sections, options);
		enter();
		await wait(hoverDelay + 30);
		assert.strictEqual(panels().length, 1);

		leave();
		assert.strictEqual(panels().length, 0);
	});

	it("opens nothing when the pointer left before the delay was up", async () => {
		wireEffectTooltip(host, sections, options);

		enter();
		leave();
		await wait(hoverDelay + 30);

		assert.strictEqual(panels().length, 0);
	});

	// A re-render replaces every card, and the pointer resting on one leaves this timer behind.
	// Without the guard the panel of a card that is no longer on screen opens over the new graph.
	it("opens nothing for a card the re-render took away mid-hover", async () => {
		wireEffectTooltip(host, sections, options);

		enter();
		host.remove();
		await wait(hoverDelay + 30);

		assert.strictEqual(panels().length, 0);
	});

	describe("clampBelowToolbar", () => {
		it("pushes a popup that would open under the strip clear of it", () => {
			assert.strictEqual(clampBelowToolbar(10, 52, 4), 56);
		});

		it("leaves a popup that already clears the strip where it is", () => {
			assert.strictEqual(clampBelowToolbar(200, 52, 4), 200);
		});
	});
});
