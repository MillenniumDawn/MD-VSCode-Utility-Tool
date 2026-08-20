import { ConditionComplexExpr, ConditionItem, extractConditionValue } from "../../hoiformat/condition";
import { Node, Token } from "../../hoiformat/hoiparser";
import { Scope } from "../../hoiformat/scope";
import { HOIPartial, Raw, SchemaDef, convertNodeToJson } from "../../hoiformat/schema";
import { error } from "../../util/debug";
import { parseHoi4FileCached } from "../../util/fileloader";
import {
	FileLoader,
	FolderLoader,
	LoadResult,
	LoadResultOD,
} from "../../util/loader/loader";
import { flatten } from "lodash";

// A decisions file names the categories its decisions belong to but never defines them: the tab's
// icon, its sort order and whether the game draws it with a custom GUI all live in
// common/decisions/categories. Without reading that folder the preview could not show "the icon and
// localisation within the category" at all.
//
// It is a FolderLoader rather than a one-off scan so the folder is a tracked dependency: editing a
// category file refreshes an open decision preview the same way editing the decisions file does.
export const decisionCategoriesFolder = "common/decisions/categories";

export interface HOIDecisionCategory {
	name: string;
	// The tab sprite. `GFX_decision_*` or a bare token the game prefixes, same as a decision's icon.
	icon: string | undefined;
	// The large art in the category header, always a full `GFX_` name where it is written at all.
	picture: string | undefined;
	priority: number | undefined;
	// The scripted GUI that replaces the category's body. Resolving this to a window is
	// guiwindowindex.ts's job; the name is all the category file says.
	scriptedGui: string | undefined;
	visibleWhenEmpty: boolean;
	visibilityType: string | undefined;
	allowed: ConditionComplexExpr;
	hasAllowed: boolean;
	visible: ConditionComplexExpr;
	hasVisible: boolean;
	token: Token | undefined;
	file: string;
}

interface CategoryDef {
	icon: Raw;
	picture: string;
	priority: number;
	scripted_gui: string;
	visible_when_empty: boolean;
	visibility_type: string;
	allowed: Raw;
	visible: Raw;
}

const categorySchema: SchemaDef<CategoryDef> = {
	// Raw, because a category icon is written both as a bare token and as a quoted string.
	icon: "raw",
	picture: "string",
	priority: "number",
	scripted_gui: "string",
	visible_when_empty: "boolean",
	visibility_type: "string",
	allowed: "raw",
	visible: "raw",
};

export function getDecisionCategoriesFromFile(node: Node, filePath: string): HOIDecisionCategory[] {
	const categories: HOIDecisionCategory[] = [];
	if (!Array.isArray(node.value)) {
		return categories;
	}

	for (const child of node.value) {
		if (!child.name || !Array.isArray(child.value)) {
			continue;
		}
		categories.push(readCategory(child, child.name, filePath));
	}

	return categories;
}

function readCategory(node: Node, name: string, filePath: string): HOIDecisionCategory {
	const def = convertNodeToJson<CategoryDef>(node, categorySchema);

	// The conditions are read for display only, so the leaves are not collected into a shared
	// expression table: a category file is a dependency of the preview, not the file being previewed.
	const scope: Scope = { scopeName: "", scopeType: "country" };
	const throwaway: ConditionItem[] = [];
	const condition = (raw: Raw | undefined): ConditionComplexExpr =>
		raw ? extractConditionValue(raw._raw.value, scope, throwaway).condition : true;

	return {
		name,
		icon: readIconToken(def),
		picture: def.picture,
		priority: def.priority,
		scriptedGui: def.scripted_gui,
		visibleWhenEmpty: def.visible_when_empty ?? false,
		visibilityType: def.visibility_type,
		allowed: condition(def.allowed),
		hasAllowed: def.allowed !== undefined,
		visible: condition(def.visible),
		hasVisible: def.visible !== undefined,
		token: node.nameToken ?? undefined,
		file: filePath,
	};
}

function readIconToken(def: HOIPartial<CategoryDef>): string | undefined {
	const value = def.icon?._raw.value;
	if (typeof value === "string") {
		return value;
	}
	if (value && typeof value === "object" && !Array.isArray(value) && "name" in value) {
		return (value as { name: string }).name;
	}
	return undefined;
}

class DecisionCategoryFileLoader extends FileLoader<HOIDecisionCategory[]> {
	protected async loadFromFile(): Promise<LoadResultOD<HOIDecisionCategory[]>> {
		try {
			const node = await parseHoi4FileCached(this.file);
			return { result: getDecisionCategoriesFromFile(node, this.file) };
		} catch (e) {
			// One unparseable category file must not cost the preview every other category, so it is
			// logged and skipped rather than failing the folder.
			error(e);
			return { result: [] };
		}
	}

	public toString() {
		return `[DecisionCategoryFileLoader: ${this.file}]`;
	}
}

export class DecisionCategoriesLoader extends FolderLoader<
	HOIDecisionCategory[],
	HOIDecisionCategory[]
> {
	constructor() {
		super(decisionCategoriesFolder, DecisionCategoryFileLoader);
	}

	protected mergeFiles(
		fileResults: LoadResult<HOIDecisionCategory[]>[],
	): Promise<LoadResult<HOIDecisionCategory[]>> {
		return Promise.resolve({
			result: flatten(fileResults.map((r) => r.result)),
			dependencies: [this.folder + "/*"],
		});
	}

	public toString() {
		return "[DecisionCategoriesLoader]";
	}
}

// Categories are keyed by name; a name defined twice keeps the first, the way the game reads the
// folder in order.
export function categoriesByName(
	categories: HOIDecisionCategory[],
): Record<string, HOIDecisionCategory> {
	const result: Record<string, HOIDecisionCategory> = {};
	for (const category of categories) {
		if (!(category.name in result)) {
			result[category.name] = category;
		}
	}
	return result;
}
