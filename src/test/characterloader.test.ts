import * as assert from "assert";
import * as vscode from "vscode";
import { CharactersLoader, traitIconSprite } from "../previewdef/character/loader";
import { CharacterTrait } from "../util/characterTraits";
import { LoaderSession } from "../util/loader/loader";
import { clearDlcZipCache } from "../util/fileloader";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// Drives CharactersLoader.postLoad against a stubbed mod tree holding one trait file per trait
// directory and one modifier-definitions file, served from the HOI4 install path (no workspace
// folders).
//
// What is being pinned is the dependency list. A character card says nothing on its own: every
// modifier on it was read out of a trait file, and how that modifier is spelled was read out of
// common/modifier_definitions. Report only the character file, as this loader first did, and editing
// a trait leaves an open preview showing the numbers from before the edit until the character file
// is touched or the panel is reopened -- silently, which is the worst way for a preview to be wrong.
describe("previewdef/character/loader dependencies", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;

	function uriPath(uri: any): string {
		return String(uri.fsPath ?? uri.path ?? "");
	}

	// Which directory of the stub tree a uri is in, or undefined for anything else.
	const directories: Record<string, string[]> = {
		country_leader: ["00_traits.txt", "notes.md"],
		unit_leader: ["01_army_leader_traits.txt"],
		scientist_traits: ["00_traits.txt"],
		modifier_definitions: ["00_modifier_definitions.txt"],
	};

	function directoryOf(uri: any): string | undefined {
		const path = uriPath(uri).replace(/\\/g, "/");
		return Object.keys(directories).find((name) =>
			new RegExp(`(^|/)common/${name}$`).test(path),
		);
	}

	beforeEach(function () {
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			stat: async (uri: any) => ({
				type: directoryOf(uri) !== undefined ? Directory : File,
				mtime: 1,
				ctime: 0,
				size: 0,
			}),
			readDirectory: async (uri: any) => {
				const directory = directoryOf(uri);
				return directory === undefined
					? []
					: directories[directory]!.map((f) => [f, File] as [string, vscode.FileType]);
			},
			readFile: async () => Buffer.from("leader_traits = { }"),
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		// Drop the 3s directory-listing cache so listings don't leak between tests.
		await clearDlcZipCache();
	});

	function postLoad(content: string): Promise<any> {
		const loader = new CharactersLoader("common/characters/TST.txt");
		return (loader as any).postLoad(content, [], undefined, new LoaderSession(true));
	}

	const characters = `characters = {
    TST_someone = {
        advisor = { slot = army_chief traits = { army_chief_planning_3 } }
    }
}`;

	it("reports every trait file and modifier-definitions file it read, beside the character file", async function () {
		const result = await postLoad(characters);

		assert.deepStrictEqual(result.dependencies, [
			"common/characters/TST.txt",
			"common/country_leader/00_traits.txt",
			"common/unit_leader/01_army_leader_traits.txt",
			"common/scientist_traits/00_traits.txt",
			"common/modifier_definitions/00_modifier_definitions.txt",
		]);
	});

	it("leaves out what it never read", async function () {
		const result = await postLoad(characters);

		// A .md sitting in a trait directory is not a trait file and is not parsed, so an edit to it
		// has nothing to bring the preview back for.
		assert.ok(!result.dependencies.includes("common/country_leader/notes.md"));
	});

	it("still parses the characters it was given", async function () {
		const result = await postLoad(characters);

		assert.deepStrictEqual(
			result.result.characters.characters.map((c: any) => c.id),
			["TST_someone"],
		);
	});
});

// Which sprite a trait's medal is. None of the three trait directories writes this the same way,
// and the one that writes nothing at all -- common/unit_leader -- is the one the mod's own
// commander traits live in, so it is also the one that will silently draw nothing if the
// convention here is wrong.
describe("previewdef/character/loader trait medals", function () {
	function traitOf(over: Partial<CharacterTrait>): CharacterTrait {
		return {
			id: "x",
			source: "country_leader",
			types: [],
			traitType: undefined,
			modifiers: [],
			skillBonuses: [],
			groups: [],
			researchBonuses: [],
			icon: undefined,
			spriteFrame: undefined,
			file: "test.txt",
			token: undefined,
			...over,
		};
	}

	it("takes the sprite name a trait writes outright", function () {
		assert.deepStrictEqual(
			traitIconSprite(traitOf({ icon: "GFX_scientist_trait_genius", source: "scientist" })),
			{ name: "GFX_scientist_trait_genius", frame: 0 },
		);
	});

	it("reads an advisor trait's sprite number as a 1-based frame of the traits strip", function () {
		// `sprite = 1` is the sheet's first frame, so the index into it is one less. Getting this
		// wrong draws every advisor the medal of the trait next to it, which nothing else catches.
		assert.deepStrictEqual(traitIconSprite(traitOf({ spriteFrame: 1 })), {
			name: "GFX_idea_traits_strip",
			frame: 0,
		});
		assert.deepStrictEqual(traitIconSprite(traitOf({ spriteFrame: 13 })), {
			name: "GFX_idea_traits_strip",
			frame: 12,
		});
	});

	it("builds a commander trait's sprite name from its id, literally", function () {
		// The game's convention is GFX_trait_ + the whole id, so the base-game trait actually
		// called `trait_engineer` looks up GFX_trait_trait_engineer. Stripping the prefix that
		// looks redundant is exactly the bug to avoid.
		assert.deepStrictEqual(
			traitIconSprite(traitOf({ id: "war_hero", source: "unit_leader" })),
			{ name: "GFX_trait_war_hero", frame: 0 },
		);
		assert.deepStrictEqual(
			traitIconSprite(traitOf({ id: "trait_engineer", source: "unit_leader" })),
			{ name: "GFX_trait_trait_engineer", frame: 0 },
		);
	});

	it("has no medal for an advisor trait that names no sprite", function () {
		// Only unit_leader traits get a name built for them; a country_leader trait without a
		// `sprite` has nothing to look up, and guessing GFX_trait_<id> for it would find either
		// nothing or the wrong picture.
		assert.strictEqual(traitIconSprite(traitOf({ id: "guerrilla_leader" })), undefined);
	});
});
