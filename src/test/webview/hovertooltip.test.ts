import "./setup";
import * as assert from "assert";
import {
	EffectTooltipOptions,
	clampBelowToolbar,
	hoverDelay,
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

function withClock(run: (advance: (ms: number) => void) => void): void {
	const previousGlobalSetTimeout = globalThis.setTimeout;
	const previousGlobalClearTimeout = globalThis.clearTimeout;
	const previousWindowSetTimeout = window.setTimeout;
	const previousWindowClearTimeout = window.clearTimeout;
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { due: number; callback: () => void }>();
	const setTimeout = ((callback: TimerHandler, delay = 0) => {
		const id = nextId++;
		timers.set(id, { due: now + Number(delay), callback: callback as () => void });
		return id;
	}) as typeof globalThis.setTimeout;
	const clearTimeout = ((id?: number) => {
		if (id !== undefined) {
			timers.delete(id);
		}
	}) as typeof globalThis.clearTimeout;
	const advance = (ms: number) => {
		const target = now + ms;
		while (true) {
			const next = [...timers.entries()]
				.filter(([, timer]) => timer.due <= target)
				.sort(([, a], [, b]) => a.due - b.due)[0];
			if (!next) {
				break;
			}
			const [id, timer] = next;
			timers.delete(id);
			now = timer.due;
			timer.callback();
		}
		now = target;
	};

	(globalThis as any).setTimeout = setTimeout;
	(globalThis as any).clearTimeout = clearTimeout;
	(window as any).setTimeout = setTimeout;
	(window as any).clearTimeout = clearTimeout;
	try {
		run(advance);
	} finally {
		(globalThis as any).setTimeout = previousGlobalSetTimeout;
		(globalThis as any).clearTimeout = previousGlobalClearTimeout;
		(window as any).setTimeout = previousWindowSetTimeout;
		(window as any).clearTimeout = previousWindowClearTimeout;
	}
}

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

	it("keeps the panel closed until the hover delay, then opens it", () => {
		withClock((advance) => {
			wireEffectTooltip(host, sections, options);
			enter();
			advance(hoverDelay - 1);
			assert.strictEqual(panels().length, 0);

			advance(1);
			assert.strictEqual(panels().length, 1);
		});
	});

	it("typesets the panel like a condition panel and heads each block", () => {
		withClock((advance) => {
			wireEffectTooltip(host, sections, options);
			enter();
			advance(hoverDelay);

			const panel = panels()[0]!;
			assert.ok(panel.classList.contains("ev-cond"));
			assert.strictEqual(panel.querySelector(".ev-cond-head")?.textContent, "Immediate effects");
			assert.ok(panel.textContent?.includes("add_political_power = 50"));
			// Placed before it is shown, so it never flashes at the top left of the window.
			assert.strictEqual((panel as HTMLDivElement).style.visibility, "");
		});
	});

	it("takes the panel away when the pointer leaves", () => {
		withClock((advance) => {
			wireEffectTooltip(host, sections, options);
			enter();
			advance(hoverDelay);
			assert.strictEqual(panels().length, 1);

			leave();
			assert.strictEqual(panels().length, 0);
		});
	});

	it("cancels the pending panel when the pointer leaves before the delay", () => {
		withClock((advance) => {
			wireEffectTooltip(host, sections, options);
			enter();
			advance(hoverDelay - 1);
			assert.strictEqual(panels().length, 0);

			leave();
			advance(1);
			assert.strictEqual(panels().length, 0);
		});
	});

	// A re-render replaces every card, and the pointer resting on one leaves this timer behind.
	// Without the guard the panel of a card that is no longer on screen opens over the new graph.
	it("opens nothing for a card the re-render took away mid-hover", () => {
		withClock((advance) => {
			wireEffectTooltip(host, sections, options);
			enter();
			host.remove();
			advance(hoverDelay);

			assert.strictEqual(panels().length, 0);
		});
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
