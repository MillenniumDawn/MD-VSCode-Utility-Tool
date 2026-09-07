import { takePostedMessages } from "./setup";
import * as assert from "assert";

// The tech tree is rendered on the host, so the country dropdown is the one control on this page that
// cannot apply itself: it tells the host which country to draw and the host sends the markup back.
// Everything here is therefore about the page keeping that dropdown honest -- listing the countries
// that have art for the folder on screen, never losing the reader's choice, and reporting it once.

const countries = {
	armor: [
		{ tag: "GER", label: "Germany (GER)" },
		{ tag: "USA", label: "United States (USA)" },
	],
	land_doctrine: [{ tag: "SOV", label: "Soviet Union (SOV)" }],
};

(window as any).techCountries = countries;
(window as any).techCountry = "USA";

const shellHtml = `
<div>
    <select id="folderSelector">
        <option value="techfolder_armor">armor</option>
        <option value="techfolder_land_doctrine">land_doctrine</option>
    </select>
    <select id="tech-country"><option value="">Generic</option></select>
</div>
<div id="techtreecontent">
    <div id="techfolder_armor" class="techfolder"></div>
    <div id="techfolder_land_doctrine" class="techfolder"></div>
</div>`;

// The module reads its globals at load and binds the toolbar on window load, as the webview does.
require("../../../webviewsrc/techtree");

describe("webview/techtree country selector", () => {
	let previousBody = "";

	function select(id: string): HTMLSelectElement {
		const element = document.getElementById(id) as HTMLSelectElement | null;
		assert.ok(element, `expected the ${id} select`);
		return element!;
	}

	function tags(): string[] {
		return Array.from(select("tech-country").options).map((o) => o.value);
	}

	function chooseFolder(value: string): void {
		const folders = select("folderSelector");
		folders.value = value;
		folders.dispatchEvent(new Event("change"));
	}

	before(() => {
		previousBody = document.body.innerHTML;
		document.body.innerHTML = shellHtml;
		window.dispatchEvent(new Event("load"));
		takePostedMessages();
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	it("lists the countries with art for the folder on screen, and restores the stored choice", () => {
		assert.deepStrictEqual(tags(), ["", "GER", "USA"]);
		assert.strictEqual(select("tech-country").value, "USA");
	});

	it("re-lists when the folder changes", () => {
		chooseFolder("techfolder_land_doctrine");

		// USA has no art in this folder, but dropping it would silently disagree with the host, which
		// is still drawing the tree for USA.
		assert.deepStrictEqual(tags(), ["", "SOV", "USA"]);
		assert.strictEqual(select("tech-country").value, "USA");
	});

	it("tells the host once when the reader picks a country", () => {
		const country = select("tech-country");
		country.value = "SOV";
		country.dispatchEvent(new Event("change"));

		assert.deepStrictEqual(takePostedMessages(), [
			{ command: "setPreviewOption", key: "technology.country", value: "SOV" },
		]);
	});

	it("carries the chosen country into a folder that has no art for it", () => {
		chooseFolder("techfolder_armor");

		assert.deepStrictEqual(tags(), ["", "GER", "USA", "SOV"]);
		assert.strictEqual(select("tech-country").value, "SOV");
	});

	it("re-lists from an in-place update that carries new countries", () => {
		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: {
					type: "updateBody",
					data: {
						folders: ["armor", "land_doctrine"],
						countries: {
							armor: [{ tag: "GER", label: "Germany (GER)" }],
							land_doctrine: [{ tag: "SOV", label: "Soviet Union (SOV)" }],
						},
					},
				},
			}),
		);

		assert.deepStrictEqual(tags(), ["", "GER", "SOV"]);
		assert.strictEqual(select("tech-country").value, "SOV");
		// The update is the host answering an edit, not the reader choosing again.
		assert.deepStrictEqual(takePostedMessages(), []);
	});
});
