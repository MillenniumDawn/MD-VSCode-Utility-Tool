import { HOIDecisionFile, getDecisionsFromFile } from "./schema";
import {
	ContentLoader,
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
import { getConfiguration, getLanguageIdInYml } from "../../util/vsccommon";
import { getDescriptorDecisionGfx } from "../../util/fileloader";
import { resolveConfiguredGfxFiles } from "../../util/configuredgfxfiles";
import {
	DecisionCategoriesLoader,
	HOIDecisionCategory,
	categoriesByName,
	decisionCategoriesFolder,
} from "./categories";
import {
	ScriptedGuiDef,
	ScriptedGuisLoader,
	scriptedGuisByName,
	scriptedGuisFolder,
} from "./scriptedgui";
import { ResolvedGuiWindow, findContainerWindows } from "../../util/guiwindowindex";
import {
	ModifierDefinitions,
	listModifierDefinitionFiles,
	loadModifierDefinitions,
} from "../../util/modifiers";

export interface DecisionsLoaderResult {
	decisions: HOIDecisionFile;
	// The category definitions the previewed file's categories resolve to, keyed by name. A category
	// the folder does not define is simply absent.
	categories: Record<string, HOIDecisionCategory>;
	// The scripted GUI a category names, keyed by that name, and the window it resolves to. Only the
	// ones this file's categories actually reference are resolved.
	scriptedGuis: Record<string, ScriptedGuiDef>;
	guiWindows: Record<string, ResolvedGuiWindow>;
	// How to name and colour a `modifier = { ... }` block, shared with the idea preview.
	modifierDefinitions: ModifierDefinitions;
	gfxFiles: string[];
}

// Where the game keeps its decision sprites, scanned for a decision whose icon the gfx index cannot
// place. A mod's own decision sprite files are named by the decisionGfxFiles setting or the
// decision_gfx list in its descriptor, never in code.
export const vanillaDecisionsGfxFile = "interface/decisions.gfx";
const decisionGfxSetting = "mdHoi4Utilities.decisionGfxFiles";

/**
 * The .gfx files decision sprites are looked up in, in order: the game's interface/decisions.gfx,
 * then what the setting names, then what the working mod's (and its parent mods') descriptors name.
 */
export async function getDecisionGfxFiles(): Promise<string[]> {
	return resolveConfiguredGfxFiles(vanillaDecisionsGfxFile, [
		...(getConfiguration().decisionGfxFiles ?? []).map((entry) => ({ entry, source: decisionGfxSetting })),
		...(await getDescriptorDecisionGfx()).map((entry) => ({ entry, source: "decision_gfx in the .mod file" })),
	]);
}

// `icon = generic_decision` is drawn from the sprite `GFX_decision_generic_decision`, but
// `icon = GFX_decision_demobilisation_button` is already a sprite name. The prefix check is
// case-insensitive because the lowercase `gfx_decision_*` spelling appears in the wild.
export function decisionSpriteName(icon: string): string {
	return /^gfx_/i.test(icon) ? icon : `GFX_decision_${icon}`;
}

export class DecisionsLoader extends ContentLoader<DecisionsLoaderResult> {
	private languageKey: string = "";
	private categoriesLoader = new DecisionCategoriesLoader();
	private scriptedGuisLoader = new ScriptedGuisLoader();

	public override async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		return (
			(await super.shouldReloadImpl(session)) ||
			this.languageKey !== getLanguageIdInYml() ||
			(await this.categoriesLoader.shouldReload(session)) ||
			(await this.scriptedGuisLoader.shouldReload(session))
		);
	}

	protected async postLoad(
		content: string | undefined,
		dependencies: Dependency[],
		error: unknown,
		session: LoaderSession,
	): Promise<LoadResultOD<DecisionsLoaderResult>> {
		if (error || content === undefined) {
			throw error;
		}

		this.languageKey = getLanguageIdInYml();

		const decisionDependencies = dependencies
			.filter((d) => d.type === "decision")
			.map((d) => d.path);
		const decisionDepFiles = await this.loaderDependencies.loadMultiple(
			decisionDependencies,
			session,
			DecisionsLoader,
		);

		const decisions = getDecisionsFromFile(
			parseHoi4File(content, localize("infile", "In file {0}:\n", this.file)),
			this.file,
		);

		// A dependent decisions file contributes its categories, so a chain that continues in another
		// file can be pulled in with `#!decision:` and read alongside this one.
		const merged: HOIDecisionFile = {
			categories: [
				...decisions.categories,
				...flatten(decisionDepFiles.map((f) => f.result.decisions.categories)),
			],
			conditionExprs: [
				...decisions.conditionExprs,
				...flatten(decisionDepFiles.map((f) => f.result.decisions.conditionExprs)),
			],
		};

		const [categoryDefs, scriptedGuiDefs] = await Promise.all([
			this.categoriesLoader.load(session),
			this.scriptedGuisLoader.load(session),
		]);

		const allCategories = categoriesByName(categoryDefs.result);
		const categories: Record<string, HOIDecisionCategory> = {};
		for (const referenced of merged.categories) {
			const definition = allCategories[referenced.name];
			if (definition) {
				categories[referenced.name] = definition;
			}
		}

		// Only the scripted GUIs this file's categories name are resolved: the interface tree is
		// large, and findContainerWindows stops parsing as soon as the names it was asked for are
		// accounted for.
		const allScriptedGuis = scriptedGuisByName(scriptedGuiDefs.result);
		const scriptedGuis: Record<string, ScriptedGuiDef> = {};
		for (const category of Object.values(categories)) {
			const name = category.scriptedGui;
			const definition = name ? allScriptedGuis[name] : undefined;
			if (name && definition) {
				scriptedGuis[name] = definition;
			}
		}

		const windowNames = uniq(
			Object.values(scriptedGuis)
				.map((g) => g.windowName)
				.filter((n): n is string => n !== undefined),
		);
		const [guiWindows, modifierDefinitions, definitionFiles, decisionGfxFiles] = await Promise.all([
			findContainerWindows(windowNames),
			loadModifierDefinitions(),
			listModifierDefinitionFiles(),
			getDecisionGfxFiles(),
		]);

		const icons = uniq(
			merged.categories
				.flatMap((c) => c.decisions)
				.flatMap((d) => d.icons.map((i) => i.key))
				.map(decisionSpriteName),
		);
		const categoryIcons = Object.values(categories)
			.flatMap((c) => [c.icon ? decisionSpriteName(c.icon) : undefined, c.picture])
			.filter((n): n is string => n !== undefined);

		const gfxDependencies = [
			...dependencies.filter((d) => d.type === "gfx").map((d) => d.path),
			...flatten(decisionDepFiles.map((f) => f.result.gfxFiles)),
			...(await getGfxContainerFiles(uniq([...icons, ...categoryIcons]))),
		];

		return {
			result: {
				decisions: merged,
				categories,
				scriptedGuis,
				guiWindows,
				modifierDefinitions,
				gfxFiles: uniq([...gfxDependencies, ...decisionGfxFiles]),
			},
			dependencies: uniq([
				this.file,
				...decisionDependencies,
				...mergeInLoadResult(decisionDepFiles, "dependencies"),
				`${decisionCategoriesFolder}/*`,
				`${scriptedGuisFolder}/*`,
				...decisionGfxFiles,
				// How every modifier line reads; renderDecisionFile forces the session on an edit.
				...definitionFiles,
			]),
		};
	}

	public override toString() {
		return `[DecisionsLoader ${this.file}]`;
	}
}
