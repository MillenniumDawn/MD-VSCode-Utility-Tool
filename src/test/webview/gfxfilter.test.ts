import { loadEntrypoint, useEntrypoint } from "./setup";
import * as assert from "assert";


const gfxEntrypoint = require.resolve("../../../webviewsrc/gfx");
delete require.cache[gfxEntrypoint];
const { listeners } = loadEntrypoint(
	() => require("../../../webviewsrc/gfx") as typeof import("../../../webviewsrc/gfx"),
);

describe("webview/gfx rendering", () => {
	useEntrypoint(listeners);

	let previousBody = "";

	before(() => {
		previousBody = document.body.innerHTML;
		document.body.innerHTML = `
			<input id="filter" type="text">
			<div id="gfx-image-list">
				<div id="GFX_tank" class="spriteTypePreview"></div>
				<div id="GFX_plane" class="spriteTypePreview"></div>
			</div>`;
		window.dispatchEvent(new (window as any).Event("load"));
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	function input(): HTMLInputElement {
		return document.getElementById("filter") as HTMLInputElement;
	}

	it("filters on input and shows every sprite again when cleared", () => {
		input().value = "tank";
		input().dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual((document.getElementById("GFX_tank") as HTMLElement).style.display, "inline-block");
		assert.strictEqual((document.getElementById("GFX_plane") as HTMLElement).style.display, "none");

		input().value = "";
		input().dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual((document.getElementById("GFX_tank") as HTMLElement).style.display, "inline-block");
		assert.strictEqual((document.getElementById("GFX_plane") as HTMLElement).style.display, "inline-block");
	});

	it("applies pasted and cut text after the browser updates the field", () => {
		input().value = "plane";
		input().dispatchEvent(new (window as any).Event("paste"));
		input().dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual((document.getElementById("GFX_tank") as HTMLElement).style.display, "none");
		assert.strictEqual((document.getElementById("GFX_plane") as HTMLElement).style.display, "inline-block");

		input().value = "";
		input().dispatchEvent(new (window as any).Event("cut"));
		input().dispatchEvent(new (window as any).Event("input"));
		assert.strictEqual((document.getElementById("GFX_tank") as HTMLElement).style.display, "inline-block");
		assert.strictEqual((document.getElementById("GFX_plane") as HTMLElement).style.display, "inline-block");
	});
});
