import * as assert from "assert";
import * as vscode from "vscode";
import { renderIdeaFile } from "../previewdef/idea/contentbuilder";
import { serializeUpdate, LoaderRenderResult } from "../previewdef/loaderpreview";
import { IdeaPreviewPayload } from "../previewdef/idea/payload";
import { getIdeasFromFile } from "../previewdef/idea/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { IdeaSwap } from "../util/ideaSwapIndex";
import { ModifierDefinitions } from "../previewdef/idea/modifiers";
import { contextContainer } from "../context";

// renderIdeaFile returns the in-place update parts { html, update } on success and a plain html
// string on the error branch. The roster is built in the webview, so the update payload carries data
// rather than markup. These drive it against a stub loader to assert the return shape, that
// serializeUpdate is stable for identical input -- the property the LoaderPreview skip relies on --
// and that the modifiers, chains and toolbar flags reach the payload.

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/ideas/test.txt");

interface StubOptions {
	swaps?: IdeaSwap[];
	swapsUnavailable?: boolean;
	modifierDefinitions?: ModifierDefinitions;
}

function loaderFor(source: string, options: StubOptions = {}) {
	return {
		load: async () => ({
			result: {
				ideas: getIdeasFromFile(parseHoi4File(source), "common/ideas/test.txt"),
				gfxFiles: [],
				modifierDefinitions: options.modifierDefinitions ?? {},
				swaps: options.swaps ?? [],
				swapsUnavailable: options.swapsUnavailable ?? false,
			},
		}),
	} as any;
}

function payloadOf(rendered: LoaderRenderResult): IdeaPreviewPayload {
	return (rendered.update!.data as { ideaPreview: IdeaPreviewPayload }).ideaPreview;
}

async function payloadFor(
	source: string,
	options: StubOptions = {},
): Promise<IdeaPreviewPayload> {
	const rendered = (await renderIdeaFile(
		loaderFor(source, options),
		uri,
		webview,
	)) as LoaderRenderResult;
	return payloadOf(rendered);
}

// The class list on an element carrying id="<id>", read out of the rendered html.
function classOf(html: string, id: string): string {
	const m = new RegExp(`id="${id}"[^>]*?class="([^"]*)"`).exec(html);
	assert.ok(m, `expected an element with id="${id}"`);
	return m![1].trim();
}

const twoIdeas = `
    ideas = {
        country = {
            HOL_shell1 = { modifier = { stability_factor = -0.1 } }
            HOL_shell2a = { research_bonus = { CAT_renewable = 0.05 } }
        }
    }
`;

describe("previewdef/idea renderIdeaFile in-place update", () => {
	it("returns { html, update } carrying the roster payload", async () => {
		const rendered = (await renderIdeaFile(
			loaderFor(twoIdeas),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.strictEqual(typeof rendered, "object");
		assert.strictEqual(typeof rendered.html, "string");
		assert.ok(rendered.update);
		assert.strictEqual(typeof rendered.update.styleCss, "string");

		const payload = payloadOf(rendered);
		assert.deepStrictEqual(
			payload.groups.map((g) => g.category),
			["country"],
		);
		assert.deepStrictEqual(
			payload.cards.map((c) => c.id),
			["HOL_shell1", "HOL_shell2a"],
		);
	});

	it("serializeUpdate is stable for identical input, even though the full html nonces differ", async () => {
		const a = (await renderIdeaFile(loaderFor(twoIdeas), uri, webview)) as LoaderRenderResult;
		const b = (await renderIdeaFile(loaderFor(twoIdeas), uri, webview)) as LoaderRenderResult;

		// The full html carries fresh CSP nonces per render so it never hashes equal; the update
		// parts must be byte-identical so a no-op edit skips.
		assert.notStrictEqual(a.html, b.html);
		assert.strictEqual(serializeUpdate(a.update!), serializeUpdate(b.update!));
	});

	it("serializeUpdate differs when the input changed", async () => {
		const a = (await renderIdeaFile(loaderFor(twoIdeas), uri, webview)) as LoaderRenderResult;
		const c = (await renderIdeaFile(
			loaderFor(`ideas = { country = { HOL_shell1 = { modifier = { stability_factor = 0.2 } } } }`),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.notStrictEqual(serializeUpdate(a.update!), serializeUpdate(c.update!));
	});

	it("keeps the shell class name stable across renders so an in-place update never strands it", async () => {
		const one = (await renderIdeaFile(loaderFor(twoIdeas), uri, webview)) as LoaderRenderResult;
		const two = (await renderIdeaFile(
			loaderFor(`${twoIdeas}\nideas = { hidden_ideas = { HOL_hidden = { } } }`),
			uri,
			webview,
		)) as LoaderRenderResult;

		const content = classOf(one.html, "ideapreviewcontent");
		assert.strictEqual(content, "st-ideapreviewcontent");
		assert.strictEqual(classOf(two.html, "ideapreviewcontent"), content);
		assert.ok(two.update!.styleCss!.includes(`.${content} {`));
	});

	it("loads the shared card stylesheet as well as its own", async () => {
		// The asset hrefs are resolved against the extension uri, so there is nothing to assert
		// against until the container has one.
		const previous = contextContainer.current;
		contextContainer.current = {
			extensionUri: vscode.Uri.file("/ext"),
		} as any;
		try {
			const { html } = (await renderIdeaFile(
				loaderFor(twoIdeas),
				uri,
				webview,
			)) as LoaderRenderResult;

			// The cards are the ones hoicard.css draws; without it they would render unstyled.
			assert.ok(html.includes("hoicard.css"), "the shared card stylesheet must be loaded");
			assert.ok(html.includes("ideapreview.css"), "the roster stylesheet must be loaded");
			assert.ok(html.includes("common.css"), "the shared widget stylesheet must be loaded");
			assert.ok(html.includes("ideapreview.js"));
		} finally {
			contextContainer.current = previous;
		}
	});

	it("renders an error page rather than throwing when the loader fails", async () => {
		const failing = {
			load: async () => {
				throw new Error("bad file");
			},
		} as any;

		const rendered = await renderIdeaFile(failing, uri, webview);
		assert.strictEqual(typeof rendered, "string");
		// htmlEscape turns the spaces into &nbsp;, so the message is matched a word at a time.
		assert.ok((rendered as string).includes("bad"));
		assert.ok((rendered as string).includes("file"));
		assert.ok(!(rendered as string).includes("ideapreviewcontent"));
	});
});

describe("previewdef/idea renderIdeaFile payload", () => {
	it("formats modifiers into lines the webview can draw as they are", async () => {
		const payload = await payloadFor(twoIdeas);
		const card = payload.cards.find((c) => c.id === "HOL_shell1");

		assert.ok(card);
		assert.deepStrictEqual(card!.modifiers, [
			{
				key: "stability_factor",
				name: "Stability Factor",
				value: "-10%",
				tone: "bad",
			},
		]);
	});

	// A research_bonus value is always a factor, and CAT_renewable carries no suffix that would say
	// so, which is why research bonuses are formatted apart from modifiers.
	it("reads a research bonus as a percentage whatever the category is called", async () => {
		const payload = await payloadFor(twoIdeas);
		const card = payload.cards.find((c) => c.id === "HOL_shell2a");

		assert.ok(card);
		assert.strictEqual(card!.research[0]?.value, "+5%");
		assert.strictEqual(card!.research[0]?.tone, "good");
	});

	it("obeys a modifier definition rather than the _factor guess", async () => {
		const payload = await payloadFor(
			`ideas = { country = { depression = { modifier = { productivity_growth_modifier = -4 } } } }`,
			{
				modifierDefinitions: {
					productivity_growth_modifier: {
						valueType: "number",
						precision: 2,
						colorType: "good",
						postfix: "none",
					},
				},
			},
		);

		assert.strictEqual(payload.cards[0]?.modifiers[0]?.value, "-4");
		assert.strictEqual(payload.cards[0]?.modifiers[0]?.tone, "bad");
	});

	it("puts each idea's badges on its card", async () => {
		const payload = await payloadFor(`
            ideas = {
                economic_cycles = {
                    law = yes
                    depression = { level = 6 cost = 300 removal_cost = -1 default = yes }
                }
            }
        `);

		const card = payload.cards[0];
		assert.ok(card);
		assert.strictEqual(card!.isLaw, true);
		assert.strictEqual(card!.isDefault, true);
		assert.deepStrictEqual(card!.badges, ["Level 6", "Cost 300", "Not removable"]);
	});

	it("builds a chain out of the swaps and keeps a member defined elsewhere", async () => {
		const payload = await payloadFor(
			`ideas = { country = { political_power_bonus = { } } }`,
			{
				swaps: [
					{
						from: "political_power_bonus",
						to: "political_power_bonus2",
						file: "common/national_focus/00_generic.txt",
						start: 10,
						end: 20,
					},
				],
			},
		);

		assert.strictEqual(payload.chains.length, 1);
		assert.deepStrictEqual(payload.chains[0]?.ideaIds, [
			"political_power_bonus",
			"political_power_bonus2",
		]);
		assert.deepStrictEqual(payload.chains[0]?.sources[0], {
			start: 10,
			end: 20,
			file: "common/national_focus/00_generic.txt",
		});
		assert.strictEqual(payload.toolbarFlags.hasChains, true);
	});

	// A chain that touches nothing in the previewed file has nothing to draw against.
	it("drops a chain that does not reach this file", async () => {
		const payload = await payloadFor(`ideas = { country = { unrelated = { } } }`, {
			swaps: [{ from: "a", to: "b", file: "x.txt", start: 0, end: 1 }],
		});

		assert.deepStrictEqual(payload.chains, []);
		assert.strictEqual(payload.toolbarFlags.hasChains, false);
	});

	it("says when the swap index is off, so a missing chain is not read as none existing", async () => {
		const payload = await payloadFor(twoIdeas, { swapsUnavailable: true });
		assert.strictEqual(payload.toolbarFlags.chainsUnavailable, true);
	});

	it("offers only the controls the file can use", async () => {
		const payload = await payloadFor(twoIdeas);
		const flags = payload.toolbarFlags;

		assert.strictEqual(flags.hasModifiers, true);
		assert.strictEqual(flags.hasResearch, true);
		// No law category, no starting idea, no allowed/available block and no chain in this file.
		assert.strictEqual(flags.hasLaws, false);
		assert.strictEqual(flags.hasDefaults, false);
		assert.strictEqual(flags.hasConditions, false);
		assert.strictEqual(flags.hasChains, false);
	});

	it("reports conditions as available once an idea carries one", async () => {
		const payload = await payloadFor(
			`ideas = { country = { HOL_shell1 = { allowed = { original_tag = HOL } } } }`,
		);
		assert.strictEqual(payload.toolbarFlags.hasConditions, true);
	});

	it("carries each idea's source position so a card can jump to it", async () => {
		const payload = await payloadFor(twoIdeas);
		const nav = payload.cards[0]?.nav;

		assert.ok(nav);
		assert.strictEqual(nav!.file, "common/ideas/test.txt");
		assert.strictEqual(twoIdeas.slice(nav!.start, nav!.end), "HOL_shell1");
	});
});
