import "./setup";
import * as assert from "assert";
import {
	FilterControl,
	gateToggle,
	readFilterList,
	toggleBinder,
} from "../../../webviewsrc/util/toolbar";

type TestFilter = "missions" | "decisions" | "chains";

const testFilters: readonly TestFilter[] = ["missions", "decisions", "chains"];

// The strip as a content builder renders it: an input with the codicon widget the checkbox code
// inserts after it, and a combobox DivDropdown can take over.
const shellHtml = `
	<input type="checkbox" id="show-thing"><span class="checkbox-container-out"></span>
	<div id="test-filter-container">
		<div class="select-container">
			<div id="test-filters" class="select multiple-select" tabindex="0" role="combobox">
				<span class="value"></span>
				<div class="option" value="missions">Missions</div>
				<div class="option" value="decisions">Decisions</div>
				<div class="option" value="chains">In a chain</div>
			</div>
		</div>
	</div>`;

describe("webview/util/toolbar", () => {
	let previousBody = "";

	before(() => {
		previousBody = document.body.innerHTML;
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	beforeEach(() => {
		document.body.innerHTML = shellHtml;
	});

	const toggle = () => document.getElementById("show-thing") as HTMLInputElement;
	const widget = () => toggle().nextElementSibling as HTMLElement;

	describe("readFilterList", () => {
		it("keeps only known values, in the toolbar's own order", () => {
			assert.deepStrictEqual(readFilterList(testFilters, ["chains", "missions", "nonsense"]), [
				"missions",
				"chains",
			]);
		});

		it("reads anything that is not a list as no selection at all", () => {
			assert.deepStrictEqual(readFilterList(testFilters, undefined), []);
			assert.deepStrictEqual(readFilterList(testFilters, "missions"), []);
			assert.deepStrictEqual(readFilterList(testFilters, null), []);
		});
	});

	describe("gateToggle", () => {
		it("gives back the reader's stored choice while the control is offered", () => {
			assert.strictEqual(gateToggle("show-thing", true, false, true), false);
			assert.strictEqual(toggle().checked, false);
			assert.strictEqual(widget().style.display, "");
		});

		it("falls back to the neutral position when nothing was ever stored", () => {
			assert.strictEqual(gateToggle("show-thing", true, undefined, true), true);
			assert.strictEqual(toggle().checked, true);
		});

		// A control that cannot change anything for this file is taken off the strip, and forced back
		// to the position that hides nothing -- otherwise a stored "off" would hide things with no
		// control on screen to undo it.
		it("hides a control the file cannot use and forces it back to neutral", () => {
			assert.strictEqual(gateToggle("show-thing", false, false, true), true);
			assert.strictEqual(toggle().checked, true);
			assert.strictEqual(widget().style.display, "none");
		});

		it("is a no-op when the page has no such toggle", () => {
			document.body.innerHTML = "";
			assert.strictEqual(gateToggle("show-thing", true, false, true), false);
		});
	});

	describe("toggleBinder", () => {
		it("puts the toggle in its restored position without firing anything", () => {
			let applied: boolean | undefined = undefined;
			let rebuilds = 0;
			const bindToggle = toggleBinder(() => rebuilds++);

			bindToggle("show-thing", true, (value) => {
				applied = value;
			});

			assert.strictEqual(toggle().checked, true);
			assert.strictEqual(applied, undefined);
			assert.strictEqual(rebuilds, 0);
		});

		it("applies the new value and rebuilds on every click", () => {
			const applied: boolean[] = [];
			let rebuilds = 0;
			const bindToggle = toggleBinder(() => rebuilds++);
			bindToggle("show-thing", true, (value) => applied.push(value));

			toggle().checked = false;
			toggle().dispatchEvent(new (window as any).Event("change"));
			toggle().checked = true;
			toggle().dispatchEvent(new (window as any).Event("change"));

			assert.deepStrictEqual(applied, [false, true]);
			assert.strictEqual(rebuilds, 2);
		});

		it("is a no-op when the page has no such toggle", () => {
			document.body.innerHTML = "";
			const bindToggle = toggleBinder(() => assert.fail("should not rebuild"));
			assert.doesNotThrow(() => bindToggle("missing", true, () => undefined));
		});
	});

	describe("FilterControl", () => {
		function makeControl(onChange: (selection: TestFilter[]) => void = () => undefined) {
			return new FilterControl<TestFilter>({
				selectId: "test-filters",
				containerId: "test-filter-container",
				all: testFilters,
				emptyKey: "test.filterall",
				emptyText: "(All of them)",
				onChange,
			});
		}

		// A gated-out entry is hidden rather than removed, which is what stops DivDropdown offering it.
		const offered = () =>
			Array.from(document.querySelectorAll("#test-filters .option"))
				.filter((option) => !option.hasAttribute("hidden"))
				.map((option) => option.getAttribute("value"));

		const container = () => document.getElementById("test-filter-container") as HTMLDivElement;

		it("offers only the entries the file can match", () => {
			makeControl().gate((filter) => filter !== "chains", []);

			assert.deepStrictEqual(offered(), ["missions", "decisions"]);
			assert.strictEqual(container().style.display, "");
		});

		it("takes the whole control off the strip when no entry is left", () => {
			makeControl().gate(() => false, []);

			assert.deepStrictEqual(offered(), []);
			assert.strictEqual(container().style.display, "none");
		});

		// Narrowed, never rewritten: the stored selection keeps the entry, so it comes back when the
		// file does.
		it("narrows the working selection to what is still offered", () => {
			const selection = makeControl().gate((filter) => filter !== "chains", [
				"missions",
				"chains",
			]);

			assert.deepStrictEqual(selection, ["missions"]);
		});

		it("puts the closed combobox in step with a gating without calling it a choice", () => {
			const seen: TestFilter[][] = [];
			const control = makeControl((sel) => seen.push(sel));

			control.wire(["missions", "chains"]);
			// Attaching the subscription must not read the widget's own first emission as a click.
			assert.deepStrictEqual(seen, []);

			control.gate((filter) => filter !== "chains", ["missions", "chains"]);

			// The push that syncs the widget is this module's value, not the reader's, so it is not
			// stored either.
			assert.deepStrictEqual(seen, []);
			assert.strictEqual(
				document.querySelector("#test-filters > span.value")?.textContent,
				"Missions",
			);
		});

		// Drives the real widget rather than reaching past it: open the menu, tick a box, close it.
		function tick(value: TestFilter): void {
			document
				.getElementById("test-filters")!
				.dispatchEvent(new (window as any).MouseEvent("mousedown"));
			const list = document.querySelector("ul.select-dropdown");
			assert.ok(list, "the filter list should be open");
			const index = offered().indexOf(value);
			const item = list!.querySelectorAll("li")[index];
			(item!.querySelector("input[type=checkbox]") as HTMLInputElement).click();
			window.dispatchEvent(new (window as any).KeyboardEvent("keydown", { code: "Escape" }));
		}

		it("reports a real choice, normalised into the toolbar's order", () => {
			const seen: TestFilter[][] = [];
			const control = makeControl((sel) => seen.push(sel));
			control.wire(["chains"]);

			tick("missions");

			// Written in the toolbar's order, not the order they were ticked in, so a stored
			// selection cannot depend on which box the reader reached for first.
			assert.deepStrictEqual(seen, [["missions", "chains"]]);
		});

		it("is a no-op when the page has no filter list", () => {
			document.body.innerHTML = "";
			const control = makeControl(() => assert.fail("should not report a choice"));
			assert.doesNotThrow(() => control.wire(["missions"]));
			assert.deepStrictEqual(control.gate(() => true, ["missions"]), ["missions"]);
		});
	});
});
