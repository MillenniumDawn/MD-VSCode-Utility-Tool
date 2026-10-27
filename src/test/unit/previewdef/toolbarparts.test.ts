import * as assert from "assert";
import { searchHtml } from "../../../previewdef/toolbarparts";

describe("previewdef/toolbarparts searchHtml", () => {
	it("renders a prefixed count beside its search input and applies an optional input class", () => {
		assert.strictEqual(
			searchHtml("label", "focus", "Search: ", "search-box"),
			'\n        <label for="focus-searchbox" class="label">Search: </label>\n        <input id="focus-searchbox" class="search-box" type="text" />\n        <span id="focus-search-count" class="focus-search-count"></span>',
		);
	});
});
