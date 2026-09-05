import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// A stylesheet test, because a jsdom test cannot be one: the webview tests build the real DOM but
// never lay it out, so nothing in them notices when a pill is twenty pixels wide.
//
// That is not hypothetical. common.css styles the bare `button` element for the codicon buttons in
// the preview toolbars, and that rule sets a fixed 20x20 and `display: inline-block`. The trait
// pill is the only <button> any preview builds inside card content, so it inherited all three: with
// `overflow-wrap: anywhere` on a 20px box, every trait name broke after each letter and ran down
// the card one character per line, on top of the modifiers below it. The card was unreadable
// wherever a character had traits.
//
// So this pins the one thing that made it wrong -- .char-trait saying nothing about its own box --
// rather than the appearance, which is a design decision and free to change.
const resourceDir = path.join(__dirname, "..", "..", "..", "resource");

function readCss(name: string): string {
	return fs.readFileSync(path.join(resourceDir, name), "utf8");
}

// The declarations inside one rule, by selector. Deliberately crude: these files are hand-written
// and small, and a real CSS parser would be a dependency bought for four assertions.
function ruleBody(css: string, selector: string): string {
	const match = new RegExp(
		`(^|\\})[^{}]*(^|[\\s,])${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`,
		"m",
	).exec(css);
	assert.ok(match, `expected a ${selector} rule`);
	return match![3]!;
}

describe("resource/characterpreview.css trait pill", () => {
	it("is still fighting a global button rule that would break it", () => {
		// If this ever fails, the rule below stopped being load-bearing and the overrides in
		// .char-trait can go -- but check that before deleting them, not after.
		const body = ruleBody(readCss("common.css"), "button");

		assert.match(body, /width\s*:\s*20px/);
		assert.match(body, /height\s*:\s*20px/);
		assert.match(body, /display\s*:\s*inline-block/);
	});

	it("sizes itself to its own contents rather than inheriting that rule's 20x20", () => {
		const body = ruleBody(readCss("characterpreview.css"), ".char-trait");

		assert.match(body, /(^|[\s;])width\s*:/, "expected .char-trait to set its own width");
		assert.match(body, /(^|[\s;])height\s*:/, "expected .char-trait to set its own height");
		assert.match(body, /(^|[\s;])display\s*:/, "expected .char-trait to set its own display");
	});

	it("reserves the medal slot at a fixed size, medal or no medal", () => {
		// The slot is drawn on every pill, so it is the slot's own size that keeps the trait names
		// in a column on a card mixing base-game traits with the mod's, which have no sprite.
		const body = ruleBody(readCss("characterpreview.css"), ".char-trait-icon");

		assert.match(body, /width\s*:\s*\d/);
		assert.match(body, /height\s*:\s*\d/);
		assert.match(body, /flex\s*:\s*none/);
	});
});
