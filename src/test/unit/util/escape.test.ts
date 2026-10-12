import * as assert from "assert";
import { escapeAttr, htmlEscape } from "../../../util/escape";

describe("util/escape", () => {
	// [text, as htmlEscape writes it, as escapeAttr writes it]
	const escapes: [string, string, string][] = [
		["Tom & Jerry", "Tom&nbsp;&amp;&nbsp;Jerry", "Tom &amp; Jerry"],
		['<b class="x">', "&lt;b&nbsp;class=&quot;x&quot;&gt;", "&lt;b class=&quot;x&quot;&gt;"],
		["it's\nhere", "it&#039;s&#10;here", "it's\nhere"],
		// One pass: an entity already in the text is escaped once, not left alone or escaped twice.
		["&lt;", "&amp;lt;", "&amp;lt;"],
		["GFX_focus_plain", "GFX_focus_plain", "GFX_focus_plain"],
		["", "", ""],
	];

	for (const [text, html, attr] of escapes) {
		it(`escapes ${JSON.stringify(text)} for text and for an attribute`, () => {
			assert.strictEqual(htmlEscape(text), html);
			assert.strictEqual(escapeAttr(text), attr);
		});
	}
});
