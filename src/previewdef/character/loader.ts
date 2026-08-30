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
import { ModifierDefinitions, loadModifierDefinitions } from "../../util/modifiers";
import { CharacterTraits, loadCharacterTraits } from "../../util/characterTraits";

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

		// Only the sprite-name portraits need a .gfx; the path ones are read straight off disk, and
		// asking the index about a path would be a lookup per character that can never hit.
		const spriteNames = uniq(
			characters.characters
				.flatMap((c) => c.portraits)
				.map((p) => p.value)
				.filter(isSpriteName),
		);

		const [gfxContainers, modifierDefinitions, traits] = await Promise.all([
			getGfxContainerFiles(spriteNames),
			loadModifierDefinitions(),
			loadCharacterTraits(),
		]);

		const gfxFiles = uniq([
			...dependencies.filter((d) => d.type === "gfx").map((d) => d.path),
			...gfxContainers,
		]);

		return {
			result: { characters, gfxFiles, modifierDefinitions, traits },
			dependencies: [this.file],
		};
	}

	public toString() {
		return `[CharactersLoader ${this.file}]`;
	}
}
