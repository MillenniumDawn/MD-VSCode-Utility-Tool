import { HOIIdeaFile, getIdeasFromFile } from "./schema";
import {
	Dependency,
	LoadResultOD,
	LoaderSession,
	mergeInLoadResult,
} from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import uniq from "lodash/uniq";
import flatten from "lodash/flatten";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { getConfiguration } from "../../util/vsccommon";
import { LanguageAwareContentLoader } from "../languageloader";
import { getDescriptorIdeaPlaceholderIcon, getFilePathFromModOrHOI4 } from "../../util/fileloader";
import { Logger } from "../../util/logger";
import {
	ModifierDefinitions,
	listModifierDefinitionFiles,
	loadModifierDefinitions,
} from "../../util/modifiers";
import { IdeaSwap, getIdeaSwaps } from "../../util/ideaSwapIndex";
import { getFlags } from "../../util/featureflags";

export interface IdeasLoaderResult {
	ideas: HOIIdeaFile;
	gfxFiles: string[];
	modifierDefinitions: ModifierDefinitions;
	swaps: IdeaSwap[];
	// The swap index is off, so `swaps` being empty says nothing about whether chains exist.
	swapsUnavailable: boolean;
	// What an idea whose picture does not resolve is drawn with; undefined when no candidate exists.
	placeholderIcon: string | undefined;
}

// Where the game keeps the idea sprites. Pinned rather than discovered, because an idea whose
// picture the gfx index cannot place still resolves by scanning this one file.
const ideasGFX = "interface/ideas.gfx";

// The game's own placeholder for an idea picture that does not resolve. A mod's own is named by the
// idea_placeholder_icon line in its descriptor or the ideaPlaceholderIcon setting, never in code.
export const vanillaIdeaPlaceholderIcon = "gfx/interface/ideas/idea_PLACEHOLDER.dds";

/**
 * The image an idea whose picture does not resolve is drawn with: the first that exists of what the
 * working mod's (and its parent mods') descriptors name, what the setting names, and the game's own
 * placeholder. A configured image that does not exist is reported, naming where it was configured.
 */
export async function getIdeaPlaceholderIcon(): Promise<string | undefined> {
	const candidates = [
		...(await getDescriptorIdeaPlaceholderIcon()).map((entry) => ({ entry, source: "idea_placeholder_icon in the .mod file" })),
		{ entry: getConfiguration().ideaPlaceholderIcon, source: "mdHoi4Utilities.ideaPlaceholderIcon" },
	];
	for (const { entry, source } of candidates) {
		if (typeof entry !== "string" || entry.trim() === "") {
			continue;
		}
		const path = entry.trim().replace(/\\+/g, "/");
		if (await getFilePathFromModOrHOI4(path)) {
			return path;
		}
		Logger.warn(`${source}: "${entry}" is not in the mod, its parent mods or the game install -- check the path`);
	}
	return await getFilePathFromModOrHOI4(vanillaIdeaPlaceholderIcon) ? vanillaIdeaPlaceholderIcon : undefined;
}

// `picture = shell_idea` is drawn from the sprite `GFX_idea_shell_idea`.
export function ideaSpriteName(picture: string): string {
	return `GFX_idea_${picture}`;
}

export class IdeasLoader extends LanguageAwareContentLoader<IdeasLoaderResult> {

	protected async loadContent(
		content: string,
		dependencies: Dependency[],
		session: LoaderSession,
	): Promise<LoadResultOD<IdeasLoaderResult>> {
		const ideaDependencies = dependencies
			.filter((d) => d.type === "idea")
			.map((d) => d.path);
		const ideaDepFiles = await this.loaderDependencies.loadMultiple(
			ideaDependencies,
			session,
			IdeasLoader,
		);

		const ideas = getIdeasFromFile(
			parseHoi4File(content, localize("infile", "In file {0}:\n", this.file)),
			this.file,
		);

		// A dependent ideas file contributes its categories, so a file that only holds the swapped-in
		// half of a chain can be pulled in with `#!idea:` and read alongside this one.
		const merged: HOIIdeaFile = {
			categories: [
				...ideas.categories,
				...flatten(ideaDepFiles.map((f) => f.result.ideas.categories)),
			],
			conditionExprs: [
				...ideas.conditionExprs,
				...flatten(ideaDepFiles.map((f) => f.result.ideas.conditionExprs)),
			],
		};

		const pictures = uniq(
			merged.categories
				.flatMap((c) => c.ideas)
				.map((i) => i.picture)
				.filter((p): p is string => p !== undefined)
				.map(ideaSpriteName),
		);

		const gfxDependencies = [
			...dependencies.filter((d) => d.type === "gfx").map((d) => d.path),
			...flatten(ideaDepFiles.map((f) => f.result.gfxFiles)),
			...(await getGfxContainerFiles(pictures)),
		];

		const ideaIds = merged.categories.flatMap((c) => c.ideas.map((i) => i.id));

		const [modifierDefinitions, definitionFiles, swaps, placeholderIcon] = await Promise.all([
			loadModifierDefinitions(),
			listModifierDefinitionFiles(),
			getIdeaSwaps(ideaIds),
			getIdeaPlaceholderIcon(),
		]);

		return {
			result: {
				ideas: merged,
				gfxFiles: uniq([...gfxDependencies, ideasGFX]),
				modifierDefinitions,
				swaps,
				swapsUnavailable: !getFlags().ideaSwapIndex,
				placeholderIcon,
			},
			// The modifier definition and format files decide how every modifier line reads, so an edit
			// to one brings the preview back; renderIdeaFile forces the session for it.
			dependencies: uniq([
				this.file,
				...ideaDependencies,
				...mergeInLoadResult(ideaDepFiles, "dependencies"),
				...definitionFiles,
			]),
		};
	}

	public override toString() {
		return `[IdeasLoader ${this.file}]`;
	}
}
