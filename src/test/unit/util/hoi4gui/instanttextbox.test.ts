import * as assert from "assert";
import { toNumberLike, toStringAsSymbolIgnoreCase } from "../../../../hoiformat/schema";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { renderInstantTextBox } from "../../../../util/hoi4gui/instanttextbox";
import { StyleTable } from "../../../../util/styletable";
import { handOver } from "../../host";
import { shape } from "../../markup";

function configure(): void {
	handOver({ workspace: { getConfiguration: () => ({}) } });
	refreshFeatureFlags();
}

async function render(format: string | undefined) {
	const styleTable = new StyleTable();
	const html = await renderInstantTextBox(
		{
			maxwidth: toNumberLike(100),
			maxheight: toNumberLike(50),
			text: "hi",
			bordersize: { x: toNumberLike(0), y: toNumberLike(0) },
			format: format === undefined ? undefined : toStringAsSymbolIgnoreCase(format),
			_token: { start: 0, end: 1 },
		} as never,
		{ size: { width: 1920, height: 1080 }, orientation: "upper_left" },
		{ styleTable },
	);
	return { html, css: styleTable.toRawCss(), page: styleTable.toStyleElement("nonce") };
}

describe("util/hoi4gui/instanttextbox", () => {
	beforeEach(configure);
	afterEach(configure);

	// [format as the mod writes it, text-align as the preview writes it]
	const alignments = [
		["left", "left"],
		["center", "center"],
		["centre", "center"],
		["right", "right"],
		["justify", "justify"],
	];
	for (const [format, align] of alignments) {
		it(`aligns text for format = ${format}`, async () => {
			assert.ok((await render(format)).css.includes(`text-align: ${align};`));
		});
	}

	for (const format of [undefined, "up", "down", "", "constructor", "__proto__"]) {
		it(`leaves the alignment alone for format = ${JSON.stringify(format)}`, async () => {
			const { css } = await render(format);
			assert.ok(!css.includes("text-align"), css);
			assert.ok(!css.includes("undefined"), css);
		});
	}

	it("keeps a format holding a quote, a bracket and </style> out of the page", async () => {
		const hostile = await render('"left"<center></style><img src=x onerror=1>');
		const plain = await render("center");

		assert.deepStrictEqual(shape(hostile.page), shape(plain.page));
		assert.deepStrictEqual(shape(hostile.html), shape(plain.html));
		assert.ok(!hostile.css.includes("<"), hostile.css);
		assert.ok(!hostile.page.includes("<img"), hostile.page);
	});
});
