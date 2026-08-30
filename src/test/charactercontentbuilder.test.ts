import * as assert from "assert";
import * as vscode from "vscode";
import { renderCharacterFile } from "../previewdef/character/contentbuilder";
import { serializeUpdate, LoaderRenderResult } from "../previewdef/loaderpreview";
import { CharacterPreviewPayload } from "../previewdef/character/payload";
import { toolbarFlagsOf } from "../previewdef/character/build";
import { getCharactersFromFile } from "../previewdef/character/schema";
import { CharacterTraits, readTraitFile } from "../util/characterTraits";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { ModifierDefinitions } from "../util/modifiers";
import { contextContainer } from "../context";

// renderCharacterFile returns the in-place update parts { html, update } on success and a plain
// html string on the error branch. The roster is built in the webview, so the update payload
// carries data rather than markup. These drive it against a stub loader to assert the return
// shape, that serializeUpdate is stable for identical input -- the property the LoaderPreview skip
// relies on -- and that the roles, traits and toolbar flags reach the payload.

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/characters/test.txt");

interface StubOptions {
	traits?: string;
	modifierDefinitions?: ModifierDefinitions;
}

function traitsFor(source: string | undefined): CharacterTraits {
	return source === undefined
		? {}
		: readTraitFile(parseHoi4File(source), "country_leader", "common/country_leader/00.txt");
}

function loaderFor(source: string, options: StubOptions = {}) {
	return {
		load: async () => ({
			result: {
				characters: getCharactersFromFile(
					parseHoi4File(source),
					"common/characters/test.txt",
				),
				gfxFiles: [],
				modifierDefinitions: options.modifierDefinitions ?? {},
				traits: traitsFor(options.traits),
			},
		}),
	} as any;
}

function payloadOf(rendered: LoaderRenderResult): CharacterPreviewPayload {
	return (rendered.update!.data as { characterPreview: CharacterPreviewPayload })
		.characterPreview;
}

async function payloadFor(
	source: string,
	options: StubOptions = {},
): Promise<CharacterPreviewPayload> {
	const rendered = (await renderCharacterFile(
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

const massoud = `
    characters = {
        AFG_ahmed_shah_massoud = {
            name = "Ahmad Shah Massoud"
            field_marshal = {
                traits = { trickster }
                skill = 5
                attack_skill = 4
            }
            country_leader = {
                ideology = Neutral_Muslim_Brotherhood
                traits = { guerrilla_leader }
            }
            advisor = {
                slot = army_chief
                idea_token = ahmed_shah_massoud
                traits = { army_chief_planning_3 }
                cost = 100
            }
        }
        AFG_plain = {
            name = "Plain"
            corps_commander = { skill = 2 }
        }
    }
`;

const traitFile = `
    leader_traits = {
        army_chief_planning_3 = {
            sprite = 6
            planning_speed = 0.15
            experience_gain_army = 0.05
        }
        trickster = {
            modifier = { recon_factor = 0.25 }
        }
        guerrilla_leader = { }
    }
`;

describe("previewdef/character renderCharacterFile in-place update", () => {
	it("returns { html, update } carrying the roster payload", async () => {
		const rendered = (await renderCharacterFile(
			loaderFor(massoud),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.strictEqual(typeof rendered, "object");
		assert.strictEqual(typeof rendered.html, "string");
		assert.ok(rendered.update);
		assert.strictEqual(typeof rendered.update.styleCss, "string");

		assert.deepStrictEqual(
			payloadOf(rendered).cards.map((c) => c.cardId),
			[
				"AFG_ahmed_shah_massoud:field_marshal:0",
				"AFG_ahmed_shah_massoud:country_leader:1",
				"AFG_ahmed_shah_massoud:advisor:2",
				"AFG_plain:corps_commander:0",
			],
		);
	});

	it("serializeUpdate is stable for identical input, even though the full html nonces differ", async () => {
		const a = (await renderCharacterFile(
			loaderFor(massoud),
			uri,
			webview,
		)) as LoaderRenderResult;
		const b = (await renderCharacterFile(
			loaderFor(massoud),
			uri,
			webview,
		)) as LoaderRenderResult;

		// The full html carries fresh CSP nonces per render so it never hashes equal; the update
		// parts must be byte-identical so a no-op edit skips.
		assert.notStrictEqual(a.html, b.html);
		assert.strictEqual(serializeUpdate(a.update!), serializeUpdate(b.update!));
	});

	it("serializeUpdate differs when the input changed", async () => {
		const a = (await renderCharacterFile(
			loaderFor(massoud),
			uri,
			webview,
		)) as LoaderRenderResult;
		const c = (await renderCharacterFile(
			loaderFor(`characters = { AFG_plain = { corps_commander = { skill = 3 } } }`),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.notStrictEqual(serializeUpdate(a.update!), serializeUpdate(c.update!));
	});

	it("keeps the shell class name stable across renders so an in-place update never strands it", async () => {
		const one = (await renderCharacterFile(
			loaderFor(massoud),
			uri,
			webview,
		)) as LoaderRenderResult;
		const two = (await renderCharacterFile(
			loaderFor(`characters = { AFG_extra = { advisor = { slot = navy_chief } } }`),
			uri,
			webview,
		)) as LoaderRenderResult;

		const content = classOf(one.html, "characterpreviewcontent");
		assert.strictEqual(content, "st-characterpreviewcontent");
		assert.strictEqual(classOf(two.html, "characterpreviewcontent"), content);
		assert.ok(two.update!.styleCss!.includes(`.${content} {`));
	});

	it("loads the shared card stylesheet as well as its own", async () => {
		// The asset hrefs are resolved against the extension uri, so there is nothing to assert
		// against until the container has one.
		const previous = contextContainer.current;
		contextContainer.current = {
			extensionUri: vscode.Uri.file("/ext"),
		} as unknown as typeof contextContainer.current;
		try {
			const rendered = (await renderCharacterFile(
				loaderFor(massoud),
				uri,
				webview,
			)) as LoaderRenderResult;
			assert.ok(rendered.html.includes("hoicard.css"));
			assert.ok(rendered.html.includes("characterpreview.css"));
			assert.ok(rendered.html.includes("characterpreview.js"));
		} finally {
			contextContainer.current = previous;
		}
	});

	it("forces the loader session when a dependency changed rather than this file", async () => {
		// A trait file was edited, not the character file. The loader decides whether to reload by
		// hashing the character file, which has not moved, so nothing short of a forced session gets
		// the new traits onto the card.
		const forced: boolean[] = [];
		const loader = {
			load: async (session: { force: boolean }) => {
				forced.push(session.force);
				return await loaderFor(massoud).load();
			},
		} as any;

		await renderCharacterFile(loader, uri, webview, {
			partial: true,
			dependencyChanged: true,
		});
		await renderCharacterFile(loader, uri, webview, {
			partial: true,
			dependencyChanged: false,
		});
		await renderCharacterFile(loader, uri, webview);

		assert.deepStrictEqual(forced, [true, false, false]);
	});

	it("renders an error page rather than throwing when the loader fails", async () => {
		const failing = {
			load: async () => {
				throw new Error("boom");
			},
		} as any;

		const rendered = await renderCharacterFile(failing, uri, webview);
		assert.strictEqual(typeof rendered, "string");
		assert.ok((rendered as string).includes("boom"));
	});
});

describe("previewdef/character payload groups", () => {
	it("puts one group per role, in a fixed order", async () => {
		const payload = await payloadFor(massoud);

		assert.deepStrictEqual(
			payload.groups.map((g) => g.kind),
			["country_leader", "field_marshal", "corps_commander", "advisor"],
		);
	});

	it("lists a character in every group its roles put it in", async () => {
		const payload = await payloadFor(massoud);
		const advisors = payload.groups.find((g) => g.kind === "advisor");

		assert.deepStrictEqual(advisors?.cardIds, ["AFG_ahmed_shah_massoud:advisor:2"]);
	});

	it("tells each card which other roles the same character has", async () => {
		const payload = await payloadFor(massoud);
		const advisor = payload.cards.find(
			(c) => c.cardId === "AFG_ahmed_shah_massoud:advisor:2",
		);
		const plain = payload.cards.find((c) => c.cardId === "AFG_plain:corps_commander:0");

		assert.deepStrictEqual(advisor?.otherRoles, ["field_marshal", "country_leader"]);
		assert.deepStrictEqual(plain?.otherRoles, []);
	});

	it("keeps every slot of a character who writes the same role several times", async () => {
		// Millennium Dawn's VER gives one character three separate advisor blocks. Keyed on the role
		// kind alone all three cards would share an id, and the webview's id->card map would hold only
		// the last of them and draw it once per slot -- three identical cards where the file wrote
		// three different jobs.
		const payload = await payloadFor(
			`
                characters = {
                    VER_x = {
                        advisor = { slot = army_chief idea_token = x_army traits = { a } }
                        advisor = { slot = navy_chief idea_token = x_navy traits = { b } }
                        advisor = { slot = air_chief idea_token = x_air traits = { c } }
                    }
                }
            `,
			{
				traits: `leader_traits = {
                    a = { modifier = { army_morale_factor = 0.1 } }
                    b = { modifier = { navy_max_range_factor = 0.1 } }
                    c = { modifier = { air_accidents_factor = -0.1 } }
                } `,
			},
		);
		const advisors = payload.groups.find((g) => g.kind === "advisor");

		assert.deepStrictEqual(advisors?.cardIds, [
			"VER_x:advisor:0",
			"VER_x:advisor:1",
			"VER_x:advisor:2",
		]);
		assert.deepStrictEqual(
			payload.cards.map((c) => c.badges[0]),
			["army_chief", "navy_chief", "air_chief"],
		);
		assert.deepStrictEqual(
			payload.cards.map((c) => c.traits.map((t) => t.id).join()),
			["a", "b", "c"],
		);
		// The ids the group lists are the ids the cards carry: nothing in the roster resolves to the
		// same card twice.
		assert.deepStrictEqual(
			advisors?.cardIds,
			payload.cards.map((c) => c.cardId),
		);
	});

	it("names each other role once on a character who repeats one of them", async () => {
		const payload = await payloadFor(`
            characters = {
                VER_y = {
                    country_leader = { ideology = neutrality }
                    advisor = { slot = army_chief }
                    advisor = { slot = navy_chief }
                }
            }
        `);
		const leader = payload.cards.find((c) => c.roleKind === "country_leader");

		assert.deepStrictEqual(leader?.otherRoles, ["advisor"]);
	});

	it("still shows a character that carries no role at all", async () => {
		const payload = await payloadFor(
			`characters = { AFG_halfwritten = { name = "Half Written" } }`,
		);

		assert.deepStrictEqual(
			payload.groups.map((g) => g.kind),
			["none"],
		);
		assert.deepStrictEqual(
			payload.cards.map((c) => c.cardId),
			["AFG_halfwritten:none:0"],
		);
	});

	it("puts the role's own facts on the card as badges", async () => {
		const payload = await payloadFor(massoud);
		const advisor = payload.cards.find(
			(c) => c.cardId === "AFG_ahmed_shah_massoud:advisor:2",
		);

		assert.deepStrictEqual(advisor?.badges, [
			"army_chief",
			"ahmed_shah_massoud",
			"Cost 100",
		]);
	});

	it("formats a commander's skills", async () => {
		const payload = await payloadFor(massoud);
		const marshal = payload.cards.find(
			(c) => c.cardId === "AFG_ahmed_shah_massoud:field_marshal:0",
		);

		assert.deepStrictEqual(
			marshal?.skills.map((s) => `${s.key}=${s.value}`),
			["skill=+5", "attack_skill=+4"],
		);
	});
});

describe("previewdef/character payload traits", () => {
	it("carries the modifiers the named trait grants", async () => {
		const payload = await payloadFor(massoud, { traits: traitFile });
		const advisor = payload.cards.find(
			(c) => c.cardId === "AFG_ahmed_shah_massoud:advisor:2",
		);
		const trait = advisor?.traits[0];

		assert.strictEqual(trait?.id, "army_chief_planning_3");
		assert.strictEqual(trait.known, true);
		// planning_speed is in util/modifiers.ts's override table and reads as a percentage;
		// experience_gain_army is a flat daily gain -- experience_gain_army_factor is the
		// percentage one -- so it reads as the number it is written as.
		assert.deepStrictEqual(
			trait.modifiers.map((m) => `${m.key}=${m.value}`),
			["planning_speed=+15%", "experience_gain_army=+0.05"],
		);
		assert.strictEqual(trait.hasDetail, true);
	});

	it("flags a trait nothing defines instead of dropping it", async () => {
		const payload = await payloadFor(
			`characters = { AFG_x = { advisor = { traits = { made_up_trait } } } }`,
			{ traits: traitFile },
		);
		const card = payload.cards[0];

		assert.strictEqual(card?.traits[0]?.id, "made_up_trait");
		assert.strictEqual(card.traits[0]?.known, false);
		assert.strictEqual(card.hasUnknownTrait, true);
		assert.strictEqual(payload.toolbarFlags.hasUnknownTraits, true);
	});

	it("marks a trait that is defined but grants nothing as having no detail", async () => {
		const payload = await payloadFor(massoud, { traits: traitFile });
		const leader = payload.cards.find(
			(c) => c.cardId === "AFG_ahmed_shah_massoud:country_leader:1",
		);

		assert.strictEqual(leader?.traits[0]?.id, "guerrilla_leader");
		assert.strictEqual(leader.traits[0]?.known, true);
		assert.strictEqual(leader.traits[0]?.hasDetail, false);
	});

	it("keeps a trait's per-role and equipment blocks as named groups", async () => {
		const payload = await payloadFor(
			`characters = { AFG_x = { corps_commander = { traits = { old_guard } } } }`,
			{
				traits: `
                    leader_traits = {
                        old_guard = {
                            attack_skill = 1
                            modifier = { max_dig_in = 1 }
                            non_shared_modifier = { experience_gain_factor = -0.25 }
                        }
                    }
                `,
			},
		);
		const trait = payload.cards[0]?.traits[0];

		assert.deepStrictEqual(
			trait?.groups.map((g) => g.title),
			["Skill bonuses", "non_shared_modifier"],
		);
	});
});

describe("previewdef/character toolbar flags", () => {
	it("offers nothing a file cannot use", async () => {
		const payload = await payloadFor(
			`characters = { AFG_x = { corps_commander = { } } }`,
		);

		assert.deepStrictEqual(payload.toolbarFlags, {
			hasLocalisation: false,
			hasDescriptions: false,
			hasPortraits: false,
			hasSkills: false,
			hasTraitDetail: false,
			hasConditions: false,
			hasMultiRole: false,
			hasUnknownTraits: false,
			hasMissingPortraits: false,
		});
	});

	it("offers the skill, trait and multi-role controls once the file uses them", async () => {
		const payload = await payloadFor(massoud, { traits: traitFile });

		assert.strictEqual(payload.toolbarFlags.hasSkills, true);
		assert.strictEqual(payload.toolbarFlags.hasTraitDetail, true);
		assert.strictEqual(payload.toolbarFlags.hasMultiRole, true);
		assert.strictEqual(payload.toolbarFlags.hasUnknownTraits, false);
	});

	it("offers the description control for a file whose only description is a trait's", () => {
		// The same toggle draws both, so reading only the character's description hid the control on
		// every file that localises its traits and not its people.
		const loc = (key: string, text: string) => ({ key, text });
		const cardWith = (desc: { key: string; text: string }, traitDesc: { key: string; text: string }) =>
			({
				name: loc("x", "x"),
				desc,
				portrait: undefined,
				portraitMissing: false,
				otherRoles: [],
				skills: [],
				traits: [{ desc: traitDesc, hasDetail: false }],
				hasUnknownTrait: false,
				allowed: true,
				available: true,
				visible: true,
			}) as never;

		assert.strictEqual(
			toolbarFlagsOf([cardWith(loc("a_desc", "a_desc"), loc("t_desc", "Steady hand"))])
				.hasDescriptions,
			true,
		);
		assert.strictEqual(
			toolbarFlagsOf([cardWith(loc("a_desc", "a_desc"), loc("t_desc", "t_desc"))])
				.hasDescriptions,
			false,
		);
	});

	it("offers the condition control once a role is gated", async () => {
		const payload = await payloadFor(
			`characters = { AFG_x = { advisor = { available = { has_war = no } } } }`,
		);

		assert.strictEqual(payload.toolbarFlags.hasConditions, true);
	});
});
