import { HOICharacterFile, getCharactersFromFile } from "./schema";
import {
	ContentLoader,
	Dependency,
	LoadResultOD,
	LoaderSession,
} from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq } from "lodash";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { getLanguageIdInYml } from "../../util/vsccommon";
import {
	ModifierDefinitions,
	listModifierDefinitionFiles,
	loadModifierDefinitions,
} from "../../util/modifiers";
import {
	CharacterTrait,
	CharacterTraits,
	loadCharacterTraits,
} from "../../util/characterTraits";

export interface CharactersLoaderResult {
	characters: HOICharacterFile;
	gfxFiles: string[];
	modifierDefinitions: ModifierDefinitions;
	traits: CharacterTraits;
}

// A portrait is written either as a path into the mod -- which the image cache reads directly --
// or as the name of a sprite, which has to be looked up in a .gfx first.
export function isSpriteName(portrait: string): boolean {
	return portrait.toLowerCase().startsWith("gfx_");
}

// The sheet every country_leader trait's `sprite = N` indexes into. Defined once, in
// interface/ideas.gfx, with eighteen frames; Millennium Dawn does not redefine it.
const traitStripSprite = "GFX_idea_traits_strip";

// Which sprite, and which frame of it, is the trait's medal.
//
// The three trait directories name their icon three different ways, and only one of them writes
// anything down -- see the comment on CharacterTrait.icon. The unit_leader case is a naming
// convention with no key behind it, and it is a literal one: `trait_engineer` looks up
// `GFX_trait_trait_engineer`, not `GFX_trait_engineer`.
export function traitIconSprite(
	trait: CharacterTrait,
): { name: string; frame: number } | undefined {
	if (trait.icon) {
		return { name: trait.icon, frame: 0 };
	}
	if (trait.spriteFrame !== undefined) {
		// `sprite = 1` is the first frame.
		return { name: traitStripSprite, frame: trait.spriteFrame - 1 };
	}
	if (trait.source === "unit_leader") {
		return { name: "GFX_trait_" + trait.id, frame: 0 };
	}
	return undefined;
}

export class CharactersLoader extends ContentLoader<CharactersLoaderResult> {
	private languageKey: string = "";

	public async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		return (
			(await super.shouldReloadImpl(session)) ||
			this.languageKey !== getLanguageIdInYml()
		);
	}

	protected async postLoad(
		content: string | undefined,
		dependencies: Dependency[],
		error: unknown,
		// A characters file has no dependent characters file to pull in, so nothing here loads
		// through the session the way the idea loader's `#!idea:` dependencies do.
		_session: LoaderSession,
	): Promise<LoadResultOD<CharactersLoaderResult>> {
		if (error || content === undefined) {
			throw error;
		}

		this.languageKey = getLanguageIdInYml();

		const characters = getCharactersFromFile(
			parseHoi4File(content, localize("infile", "In file {0}:\n", this.file)),
			this.file,
		);

		const [modifierDefinitions, definitionFiles, traits] = await Promise.all([
			loadModifierDefinitions(),
			listModifierDefinitionFiles(),
			loadCharacterTraits(),
		]);

		// Only the sprite-name portraits need a .gfx; the path ones are read straight off disk, and
		// asking the index about a path would be a lookup per character that can never hit.
		const portraitSprites = characters.characters
			.flatMap((c) => c.portraits)
			.map((p) => p.value)
			.filter(isSpriteName);

		// The trait medals, which is why the .gfx lookup waits on the traits rather than running
		// alongside them: a trait's sprite name is not in the characters file, it comes from the
		// trait definition -- or, for a commander trait, from nothing but the id. The names dedupe
		// hard, so a file of a hundred advisors asks about one strip.
		const traitSprites = uniq(
			characters.characters.flatMap((c) => c.roles).flatMap((r) => r.traits),
		)
			.map((id) => traits.traits[id])
			.filter((trait): trait is CharacterTrait => trait !== undefined)
			.map(traitIconSprite)
			.filter((sprite) => sprite !== undefined)
			.map((sprite) => sprite.name);

		const gfxContainers = await getGfxContainerFiles(
			uniq([...portraitSprites, ...traitSprites]),
		);

		const gfxFiles = uniq([
			...dependencies.filter((d) => d.type === "gfx").map((d) => d.path),
			...gfxContainers,
		]);

		return {
			result: {
				characters,
				gfxFiles,
				modifierDefinitions,
				traits: traits.traits,
			},
			// The trait and modifier-definition files are where everything a card says about what a
			// character grants comes from, so an edit to one of them has to bring the preview back.
			// Reporting them here is what subscribes this preview to them; renderCharacterFile then
			// forces the session on a dependency change, since the character file's own hash has not
			// moved and the loader would otherwise hand back its cached traits.
			dependencies: uniq([this.file, ...traits.files, ...definitionFiles]),
		};
	}

	public toString() {
		return `[CharactersLoader ${this.file}]`;
	}
}
