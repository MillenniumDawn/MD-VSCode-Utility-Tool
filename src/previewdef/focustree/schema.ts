import { Node, Token } from "../../hoiformat/hoiparser";
import {
	HOIPartial,
	SchemaDef,
	Position,
	convertNodeToJson,
	positionSchema,
	Raw,
	isSymbolNode,
} from "../../hoiformat/schema";
import { normalizeNumberLike } from "../../util/hoi4gui/common";
import { flatten, chain, groupBy } from "lodash";
import {
	ConditionItem,
	ConditionComplexExpr,
	extractConditionValues,
	extractConditionValue,
	extractConditionalExprs,
} from "../../hoiformat/condition";
import { countryScope } from "../../hoiformat/scope";
import { useConditionInFocus } from "../../util/featureflags";
import { randomString, Warning } from "../../util/common";
import { localize } from "../../util/i18n";
import * as path from "path";
import { parseInlayWindowRef } from "./inlay";
import { ContainerWindowType } from "../../hoiformat/gui";

export interface FocusTree {
	id: string;
	focuses: Record<string, Focus>;
	inlayWindowRefs: FocusTreeInlayRef[];
	inlayWindows: FocusTreeInlay[];
	inlayConditionExprs: ConditionItem[];
	allowBranchOptions: string[];
	conditionExprs: ConditionItem[];
	isSharedFocues: boolean;
	continuousFocusPositionX?: number;
	continuousFocusPositionY?: number;
	warnings: FocusWarning[];
}

interface FocusIconWithCondition {
	icon: string | undefined;
	condition: ConditionComplexExpr;
}

export interface Focus {
	x: number;
	y: number;
	id: string;
	icon: FocusIconWithCondition[];
	textIcon?: string;
	overlay?: string;
	prerequisite: string[][];
	exclusive: string[];
	hasAllowBranch: boolean;
	inAllowBranch: string[];
	allowBranch: ConditionComplexExpr | undefined;
	relativePositionId: string | undefined;
	offset: Offset[];
	token: Token | undefined;
	file: string;
	text?: string;
}

export interface FocusWarning extends Warning<string> {
	navigations?: { file: string; start: number; end: number }[];
	// Other focuses involved in this warning (e.g. the other focus of a pair), so the webview
	// can highlight every offender instead of only the warning's source.
	relatedSources?: string[];
	// Set on the layout validators' output. Such a warning describes one tree's own grid, so
	// addSharedFocus does not replay it into a tree that merges the focus in: that tree lays the
	// focus out on a different grid, and usually only part of the offending group comes across.
	layout?: boolean;
}

export interface FocusTreeInlayRef {
	id: string;
	position: { x: number; y: number };
	file: string;
	token: Token | undefined;
}

export interface FocusTreeInlay {
	id: string;
	file: string;
	token: Token | undefined;
	windowName?: string;
	guiFile?: string;
	guiWindow?: HOIPartial<ContainerWindowType>;
	internal: boolean;
	visible: ConditionComplexExpr;
	position: { x: number; y: number };
	scriptedImages: FocusInlayImageSlot[];
	scriptedButtons: FocusTreeInlayButtonMeta[];
	conditionExprs: ConditionItem[];
}

export interface FocusInlayImageSlot {
	id: string;
	file: string;
	token: Token | undefined;
	gfxOptions: FocusInlayGfxOption[];
}

export interface FocusInlayGfxOption {
	gfxName: string;
	condition: ConditionComplexExpr;
	file: string;
	token: Token | undefined;
	gfxFile?: string;
}

export interface FocusTreeInlayButtonMeta {
	id: string;
	file: string;
	token: Token | undefined;
	available?: ConditionComplexExpr;
}

interface Offset {
	x: number;
	y: number;
	trigger: ConditionComplexExpr | undefined;
}

interface FocusTreeDef {
	id: string;
	shared_focus: Raw[];
	focus: FocusDef[];
	continuous_focus_position: Position;
	inlay_window: Raw[];
}

interface FocusDef {
	id: string;
	icon: Raw[];
	text_icon: string;
	overlay: string;
	x: number;
	y: number;
	prerequisite: FocusOrORList[];
	mutually_exclusive: FocusOrORList[];
	relative_position_id: string;
	allow_branch: Raw[] /* FIXME not symbol node */;
	offset: OffsetDef[];
	// Nested focus = { ... } children of a top-level shared_focus/joint_focus block.
	focus: FocusDef[];
	_token: Token;
	text?: string;
}

interface FocusIconDef {
	trigger: Raw;
	value: string;
}

interface OffsetDef {
	x: number;
	y: number;
	trigger: Raw[];
}

interface FocusOrORList {
	focus: string[];
	// Raw node list: an OR block's contents cannot be expressed with the plain string schema
	// (a block converts via convertString to undefined), so extractOrListIds walks them.
	or: Raw[];
}

interface FocusFile {
	focus_tree: FocusTreeDef[];
	shared_focus: FocusDef[];
	joint_focus: FocusDef[];
}

const focusOrORListSchema: SchemaDef<FocusOrORList> = {
	focus: {
		_innerType: "string",
		_type: "array",
	},
	// Schema keys are matched against lowercased file keys, so this must be lowercase.
	or: {
		_innerType: "raw",
		_type: "array",
	},
};

const focusSchema: SchemaDef<FocusDef> = {
	id: "string",
	icon: {
		_innerType: "raw",
		_type: "array",
	},
	text_icon: "string",
	overlay: "string",
	x: "number",
	y: "number",
	prerequisite: {
		_innerType: focusOrORListSchema,
		_type: "array",
	},
	mutually_exclusive: {
		_innerType: focusOrORListSchema,
		_type: "array",
	},
	relative_position_id: "string",
	allow_branch: {
		_innerType: "raw",
		_type: "array",
	},
	offset: {
		_innerType: {
			x: "number",
			y: "number",
			trigger: {
				_innerType: "raw",
				_type: "array",
			},
		},
		_type: "array",
	},
	focus: {
		_innerType: undefined as any,
		_type: "array",
	},
	text: "string",
};

focusSchema.focus._innerType = focusSchema;

const focusTreeSchema: SchemaDef<FocusTreeDef> = {
	id: "string",
	// A block-form shared_focus = { SH_a SH_b } converts via convertString to undefined per
	// occurrence, so this is kept raw and walked with extractOrListIds like an OR block.
	shared_focus: {
		_innerType: "raw",
		_type: "array",
	},
	focus: {
		_innerType: focusSchema,
		_type: "array",
	},
	continuous_focus_position: positionSchema,
	inlay_window: {
		_innerType: "raw",
		_type: "array",
	},
};

const focusFileSchema: SchemaDef<FocusFile> = {
	focus_tree: {
		_innerType: focusTreeSchema,
		_type: "array",
	},
	shared_focus: {
		_innerType: focusSchema,
		_type: "array",
	},
	joint_focus: {
		_innerType: focusSchema,
		_type: "array",
	},
};

const focusIconSchema: SchemaDef<FocusIconDef> = {
	trigger: "raw",
	value: "string",
};

export function convertFocusFileNodeToJson(
	node: Node,
	constants: {},
): HOIPartial<FocusFile> {
	return convertNodeToJson<FocusFile>(node, focusFileSchema, constants);
}

export function getFocusTreeWithFocusFile(
	file: HOIPartial<FocusFile>,
	sharedFocusTrees: FocusTree[],
	filePath: string,
	constants: {},
): FocusTree[] {
	const focusTrees: FocusTree[] = [];
	if (file.shared_focus.length > 0) {
		const conditionExprs: ConditionItem[] = [];
		const warnings: FocusWarning[] = [];
		const focuses = getFocuses(
			flattenFocusGroups(file.shared_focus),
			conditionExprs,
			filePath,
			warnings,
			constants,
		);

		runLayoutValidation(focuses, warnings, false);

		const sharedFocusTree = {
			id: localize("focustree.sharedfocuses", "<Shared focuses>"),
			focuses,
			inlayWindowRefs: [],
			inlayWindows: [],
			inlayConditionExprs: [],
			allowBranchOptions: getAllowBranchOptions(focuses),
			conditionExprs,
			isSharedFocues: true,
			warnings,
		};
		focusTrees.push(sharedFocusTree);
		sharedFocusTrees = [sharedFocusTree, ...sharedFocusTrees];
	}

	if (file.joint_focus.length > 0) {
		const conditionExprs: ConditionItem[] = [];
		const warnings: FocusWarning[] = [];
		const focuses = getFocuses(
			flattenFocusGroups(file.joint_focus),
			conditionExprs,
			filePath,
			warnings,
			constants,
		);

		runLayoutValidation(focuses, warnings, false);

		focusTrees.push({
			id: getJointFocusTreeId(filePath),
			focuses,
			inlayWindowRefs: [],
			inlayWindows: [],
			inlayConditionExprs: [],
			allowBranchOptions: getAllowBranchOptions(focuses),
			conditionExprs,
			// isSharedFocues also gates loader.ts's cross-file synthetic-tree inclusion and the
			// webview's always-allow-branch handling for pseudo-trees, both of which apply here too.
			isSharedFocues: true,
			warnings,
		});
	}

	for (const focusTree of file.focus_tree) {
		const conditionExprs: ConditionItem[] = [];
		const warnings: FocusWarning[] = [];
		const focuses = getFocuses(
			focusTree.focus,
			conditionExprs,
			filePath,
			warnings,
			constants,
		);

		if (useConditionInFocus) {
			for (const sharedFocus of extractOrListIds(focusTree.shared_focus)) {
				addSharedFocus(
					focuses,
					filePath,
					sharedFocusTrees,
					sharedFocus,
					conditionExprs,
					warnings,
				);
			}
		}

		runLayoutValidation(focuses, warnings, true);

		focusTrees.push({
			id:
				focusTree.id ??
				localize("focustree.ananymous", "<Anonymous focus tree>"),
			focuses,
			inlayWindowRefs: focusTree.inlay_window
				.map((v) => v?._raw)
				.filter((v): v is Node => v !== undefined)
				.map((v) => parseInlayWindowRef(v, filePath))
				.filter((v): v is FocusTreeInlayRef => v !== undefined),
			inlayWindows: [],
			inlayConditionExprs: [],
			allowBranchOptions: getAllowBranchOptions(focuses),
			continuousFocusPositionX:
				normalizeNumberLike(focusTree.continuous_focus_position?.x, 0) ?? 50,
			continuousFocusPositionY:
				normalizeNumberLike(focusTree.continuous_focus_position?.y, 0) ?? 1000,
			conditionExprs,
			isSharedFocues: false,
			warnings,
		});
	}

	return focusTrees;
}

function getJointFocusTreeId(filePath: string): string {
	const fileName = path.basename(filePath, path.extname(filePath));
	const label = localize("focustree.jointfocustree", "<Joint focus tree>");
	return fileName ? `${label} (${fileName})` : label;
}

/**
 * Lightweight ID-only extraction for the shared focus index.
 * Skips expensive per-focus parsing (icons, conditions, prerequisites)
 * that getFocusTree/getFocuses/getFocus would do.
 */
export function extractFocusIds(node: Node): string[] {
	const constants = {};
	const file = convertFocusFileNodeToJson(node, constants);
	const ids: string[] = [];

	for (const tree of file.focus_tree) {
		for (const focus of tree.focus) {
			if (focus.id) {
				ids.push(focus.id);
			}
		}
	}
	for (const focus of file.shared_focus) {
		collectFocusIds(focus, ids);
	}
	for (const focus of file.joint_focus) {
		collectFocusIds(focus, ids);
	}

	return ids;
}

// Mirrors flattenFocusGroups: a container block itself isn't a focus, so only its (recursive)
// focus children contribute ids.
function collectFocusIds(focus: HOIPartial<FocusDef>, ids: string[]): void {
	if (focus.focus.length > 0) {
		for (const child of focus.focus) {
			collectFocusIds(child, ids);
		}
		return;
	}
	if (focus.id) {
		ids.push(focus.id);
	}
}

export function getFocusTree(
	node: Node,
	sharedFocusTrees: FocusTree[],
	filePath: string,
): FocusTree[] {
	const constants = {};
	const file = convertFocusFileNodeToJson(node, constants);

	return getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants);
}

/**
 * A top-level shared_focus/joint_focus block can be a group container (`id = SH_group  focus =
 * { ... }  focus = { ... }`) instead of a single focus. A container has no real position of its
 * own, so it is unwrapped recursively into its `focus` children instead of becoming a pseudo
 * focus. A block with no nested focus is still a single focus, as before.
 */
function flattenFocusGroups(
	hoiFocuses: HOIPartial<FocusDef>[],
): HOIPartial<FocusDef>[] {
	const result: HOIPartial<FocusDef>[] = [];
	for (const hoiFocus of hoiFocuses) {
		if (hoiFocus.focus.length > 0) {
			result.push(...flattenFocusGroups(hoiFocus.focus));
		} else {
			result.push(hoiFocus);
		}
	}
	return result;
}

function getFocuses(
	hoiFocuses: HOIPartial<FocusDef>[],
	conditionExprs: ConditionItem[],
	filePath: string,
	warnings: FocusWarning[],
	constants: {},
): Record<string, Focus> {
	const focuses: Record<string, Focus> = {};

	for (const hoiFocus of hoiFocuses) {
		const focus = getFocus(
			hoiFocus,
			conditionExprs,
			filePath,
			warnings,
			constants,
		);
		if (focus !== null) {
			if (focus.id in focuses) {
				const otherFocus = focuses[focus.id];
				if (!otherFocus) {
					continue;
				}
				warnings.push({
					text: localize(
						"focustree.warnings.focusidconflict",
						"There're more than one focuses with ID {0} in file: {1}.",
						focus.id,
						filePath,
					),
					source: focus.id,
					navigations: [
						{
							file: filePath,
							start: focus.token?.start ?? 0,
							end: focus.token?.end ?? 0,
						},
						{
							file: filePath,
							start: otherFocus.token?.start ?? 0,
							end: otherFocus.token?.end ?? 0,
						},
					],
				});
			}
			focuses[focus.id] = focus;
		}
	}

	// Propagate inAllowBranch from prerequisites to dependents via BFS
	// Build reverse map: prerequisite -> focuses that depend on it
	const allowBranchDependents = new Map<string, string[]>();
	for (const key in focuses) {
		const focus = focuses[key];
		if (!focus) {
			continue;
		}
		const prereqs = flatten(focus.prerequisite).filter((p) => p in focuses);
		for (const p of prereqs) {
			if (!allowBranchDependents.has(p)) {
				allowBranchDependents.set(p, []);
			}
			allowBranchDependents.get(p)!.push(key);
		}
	}

	// Seed queue with focuses that have allowBranch
	const abQueue: string[] = [];
	for (const key in focuses) {
		if (focuses[key]?.hasAllowBranch) {
			abQueue.push(key);
		}
	}

	while (abQueue.length > 0) {
		const sourceKey = abQueue.shift()!;
		const source = focuses[sourceKey];
		const deps = allowBranchDependents.get(sourceKey);
		if (!source || !deps) {
			continue;
		}
		for (const depKey of deps) {
			const dep = focuses[depKey];
			if (!dep) {
				continue;
			}
			let changed = false;
			for (const ab of source.inAllowBranch) {
				if (!dep.inAllowBranch.includes(ab)) {
					dep.inAllowBranch.push(ab);
					changed = true;
				}
			}
			if (changed) {
				abQueue.push(depKey);
			}
		}
	}

	return focuses;
}

function getFocus(
	hoiFocus: HOIPartial<FocusDef>,
	conditionExprs: ConditionItem[],
	filePath: string,
	warnings: FocusWarning[],
	constants: {},
): Focus | null {
	const id = hoiFocus.id ?? `[missing_id_${randomString(8)}]`;

	if (!hoiFocus.id) {
		warnings.push({
			text: localize(
				"focustree.warnings.focusnoid",
				"A focus defined in this file don't have ID: {0}.",
				filePath,
			),
			source: id,
		});
	}

	const x = hoiFocus.x ?? 0;
	const y = hoiFocus.y ?? 0;
	const relativePositionId = hoiFocus.relative_position_id;

	const exclusive = chain(hoiFocus.mutually_exclusive)
		.flatMap((f) => f.focus.concat(extractOrListIds(f.or)))
		.filter((s): s is string => s !== undefined)
		.value();
	const prerequisite = hoiFocus.prerequisite.map((p) =>
		p.focus
			.concat(extractOrListIds(p.or))
			.filter((s): s is string => s !== undefined),
	);
	const icon = parseFocusIcon(
		hoiFocus.icon.filter((v): v is Raw => v !== undefined).map((v) => v._raw),
		constants,
		conditionExprs,
	);
	const textIcon = hoiFocus.text_icon;
	const overlay = hoiFocus.overlay;
	const hasAllowBranch = hoiFocus.allow_branch.length > 0;
	const allowBranchCondition = extractConditionValues(
		hoiFocus.allow_branch
			.filter((v): v is Raw => v !== undefined)
			.map((v) => v._raw.value),
		countryScope,
		conditionExprs,
	).condition;
	const offset: Offset[] = hoiFocus.offset.map((o) => ({
		x: o.x ?? 0,
		y: o.y ?? 0,
		trigger: o.trigger
			? extractConditionValues(
					o.trigger
						.filter((v): v is Raw => v !== undefined)
						.map((v) => v._raw.value),
					countryScope,
					conditionExprs,
				).condition
			: false,
	}));

	const text = hoiFocus.text;

	return {
		id,
		icon,
		textIcon,
		overlay,
		x,
		y,
		relativePositionId,
		prerequisite,
		exclusive,
		hasAllowBranch,
		inAllowBranch: hasAllowBranch ? [id] : [],
		allowBranch: allowBranchCondition,
		offset,
		token: hoiFocus._token,
		file: filePath,
		text,
	};
}

function addSharedFocus(
	focuses: Record<string, Focus>,
	filePath: string,
	sharedFocusTrees: FocusTree[],
	sharedFocusId: string,
	conditionExprs: ConditionItem[],
	warnings: FocusWarning[],
) {
	const sharedFocusTree = sharedFocusTrees.find(
		(sft) => sharedFocusId in sft.focuses,
	);
	if (!sharedFocusTree) {
		return;
	}

	const sharedFocuses = sharedFocusTree.focuses;

	// Build reverse dependency map: focus -> focuses that depend on it
	const dependents = new Map<string, string[]>();
	// Track how many unresolved prerequisites each candidate has
	const unresolvedCount = new Map<string, number>();

	for (const key in sharedFocuses) {
		if (key in focuses) {
			continue;
		}
		const focus = sharedFocuses[key];
		if (!focus) {
			continue;
		}
		const prereqs = flatten(focus.prerequisite).filter(
			(p) => p in sharedFocuses,
		);
		if (prereqs.length === 0) {
			continue;
		}
		let unresolved = 0;
		for (const p of prereqs) {
			if (!(p in focuses)) {
				unresolved++;
				if (!dependents.has(p)) {
					dependents.set(p, []);
				}
				dependents.get(p)!.push(key);
			}
		}
		unresolvedCount.set(key, unresolved);
	}

	// BFS: start from the requested shared focus, propagate to dependents
	const queue: string[] = [sharedFocusId];
	const sharedFocus = sharedFocuses[sharedFocusId];
	if (!sharedFocus) {
		return;
	}
	focuses[sharedFocusId] = sharedFocus;
	updateConditionExprsByFocus(sharedFocus, conditionExprs);

	while (queue.length > 0) {
		const added = queue.shift()!;
		const deps = dependents.get(added);
		if (!deps) {
			continue;
		}
		for (const dep of deps) {
			const count = (unresolvedCount.get(dep) ?? 1) - 1;
			unresolvedCount.set(dep, count);
			if (count <= 0 && !(dep in focuses)) {
				const focus = sharedFocuses[dep];
				if (!focus) {
					continue;
				}
				if (focus.id in focuses) {
					const otherFocus = focuses[focus.id];
					if (!otherFocus) {
						continue;
					}
					warnings.push({
						text: localize(
							"focustree.warnings.focusidconflict2",
							"There're more than one focuses with ID {0} in files: {1}, {2}.",
							focus.id,
							filePath,
							focus.file,
						),
						source: focus.id,
						navigations: [
							{
								file: focus.file,
								start: focus.token?.start ?? 0,
								end: focus.token?.end ?? 0,
							},
							{
								file: filePath,
								start: otherFocus.token?.start ?? 0,
								end: otherFocus.token?.end ?? 0,
							},
						],
					});
				}
				focuses[dep] = focus;
				updateConditionExprsByFocus(focus, conditionExprs);
				queue.push(dep);
			}
		}
	}

	// Warnings about a focus itself (a missing id, an id defined twice) follow it into this tree,
	// but layout warnings describe the donor's grid. This tree runs validateFocusLayout over the
	// focuses it actually merged, on its own grid, so replaying the donor's would duplicate a line
	// or name a focus that never came across.
	for (const warning of sharedFocusTree.warnings) {
		if (!warning.layout && warning.source in focuses) {
			warnings.push(warning);
		}
	}
}

function updateConditionExprsByFocus(
	focus: Focus,
	conditionExprs: ConditionItem[],
) {
	if (focus.allowBranch) {
		extractConditionalExprs(focus.allowBranch, conditionExprs);
	}

	for (const offset of focus.offset) {
		if (offset.trigger) {
			extractConditionalExprs(offset.trigger, conditionExprs);
		}
	}

	for (const icon of focus.icon) {
		extractConditionalExprs(icon.condition, conditionExprs);
	}
}

function getAllowBranchOptions(focuses: Record<string, Focus>): string[] {
	return chain(focuses)
		.filter((f) => f.hasAllowBranch && f.allowBranch !== true)
		.map((f) => f.id)
		.uniq()
		.value();
}

function resolveFocusPosition(
	focus: Focus,
	focuses: Record<string, Focus>,
): { x: number; y: number } {
	// Mirrors the webview's getFocusPosition without the condition-dependent offset pass:
	// the resolved position is the focus's own x/y plus the resolved position of the
	// relative_position_id chain. Cycles are cut (validateRelativePositionId reports them).
	let x = focus.x;
	let y = focus.y;
	const seen = new Set<string>([focus.id]);
	let current =
		focus.relativePositionId !== undefined
			? focuses[focus.relativePositionId]
			: undefined;
	while (current !== undefined && !seen.has(current.id)) {
		x += current.x;
		y += current.y;
		seen.add(current.id);
		current =
			current.relativePositionId !== undefined
				? focuses[current.relativePositionId]
				: undefined;
	}
	return { x, y };
}

/**
 * Runs both layout validators over one tree and tags what they produce, so addSharedFocus can
 * tell a tree-local layout problem from a warning about the focus itself.
 *
 * A shared or joint focus file is a fragment: the game resolves it only once it is merged into a
 * country tree, so a focus there may legitimately be positioned relative to a focus defined in
 * another file. Such a fragment passes reportMissingRelativePositionTarget = false so the missing
 * anchor is not reported. Those focuses stay in the layout checks: a fragment normally hangs off
 * one external anchor, so its focuses are still positioned consistently against each other.
 */
function runLayoutValidation(
	focuses: Record<string, Focus>,
	warnings: FocusWarning[],
	reportMissingRelativePositionTarget: boolean,
) {
	const layoutWarnings: FocusWarning[] = [];
	validateRelativePositionId(
		focuses,
		layoutWarnings,
		reportMissingRelativePositionTarget,
	);
	validateFocusLayout(focuses, layoutWarnings);
	for (const warning of layoutWarnings) {
		warnings.push({ ...warning, layout: true });
	}
}

/**
 * Layout checks for the common focus-tree mistakes that make the game render a broken tree:
 * a prerequisite not positioned above its dependent (unless the two are row-mates in a mutually
 * exclusive row, see below), mutually exclusive focuses not sharing a row, and icons less than two
 * grid units apart on the same row (the sprites are two units wide, so they overlap). Positions are
 * resolved through relative_position_id chains like the preview does; condition-dependent offsets
 * are ignored.
 *
 * Checked one defining file at a time, so a country tree flags the shared and joint focuses merged
 * into it instead of only its own. The two sets are never compared against each other: a merged
 * focus is placed by offset blocks that pick a position per country, and this check ignores those,
 * so a cross-boundary pair reads as a collision that the game never draws.
 */
function validateFocusLayout(
	focuses: Record<string, Focus>,
	warnings: FocusWarning[],
) {
	for (const [filePath, fileFocuses] of Object.entries(
		groupBy(Object.values(focuses), "file"),
	)) {
		validateFocusLayoutOfFile(focuses, warnings, filePath, fileFocuses);
	}
}

function validateFocusLayoutOfFile(
	focuses: Record<string, Focus>,
	warnings: FocusWarning[],
	filePath: string,
	fileFocuses: Focus[],
) {
	// Resolved against the whole tree, so a shared focus anchored to one of the host tree's own
	// focuses lands where the preview draws it.
	const entries = fileFocuses.map((focus) => ({
		focus,
		position: resolveFocusPosition(focus, focuses),
	}));
	const positions = new Map(
		entries.map((entry) => [entry.focus.id, entry.position] as const),
	);

	// A focus is part of a side-by-side alternative row when one of its mutually exclusive partners
	// resolves to the same row it does. Millennium Dawn chains further picks along such a row (the
	// Zyuganov row in 05_russia.txt puts five alternatives on one row, two of which require an
	// earlier one on that same row), so a prerequisite there is a row-mate, not a mistake.
	// Cached per focus: y is that focus's own resolved row, so it never varies for a given id.
	const rowMateCache = new Map<string, boolean>();
	const hasExclusiveRowMate = (id: string, y: number): boolean => {
		const cached = rowMateCache.get(id);
		if (cached !== undefined) {
			return cached;
		}
		const focus = focuses[id];
		const result =
			focus !== undefined &&
			focus.exclusive.some((exclusive) => {
				const other = focuses[exclusive];
				return (
					exclusive !== id &&
					other !== undefined &&
					other.file === filePath &&
					positions.get(exclusive)?.y === y
				);
			});
		rowMateCache.set(id, result);
		return result;
	};

	const reportedPairs = new Set<string>();
	const pairKey = (a: string, b: string) =>
		a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;

	for (const { focus, position } of entries) {
		// An OR-group prerequisite is satisfied by completing any one of its focuses, so it is
		// only a layout problem when none of the group's options sits above the dependent, or
		// alongside it in a mutually exclusive row.
		for (const group of focus.prerequisite) {
			const options = group.filter((p) => {
				const prerequisite = focuses[p];
				return (
					p !== focus.id &&
					prerequisite !== undefined &&
					prerequisite.file === filePath
				);
			});
			const anySatisfied = options.some((p) => {
				const optionPosition = positions.get(p);
				if (optionPosition === undefined) {
					return false;
				}
				if (optionPosition.y < position.y) {
					return true;
				}
				// Sharing a row is only acceptable when exclusivity explains the row, either for
				// the dependent itself or for the prerequisite it chains from. A prerequisite
				// below its dependent is never excused.
				return (
					optionPosition.y === position.y &&
					(hasExclusiveRowMate(focus.id, position.y) ||
						hasExclusiveRowMate(p, position.y))
				);
			});
			if (options.length > 0 && !anySatisfied) {
				warnings.push({
					text: localize(
						"focustree.warnings.prerequisitenotabove",
						"Prerequisite {0} of focus {1} is not positioned above it.",
						options.join(", "),
						focus.id,
					),
					source: focus.id,
					relatedSources: options,
				});
			}
		}

		// Mutually exclusive focuses are drawn side by side and linked by a horizontal red
		// exclusivity marker, so they must share a row. Differing X is the normal case, not a
		// mistake: the standard idiom places the alternatives two columns apart and lets
		// allow_branch hide the loser while offset slides the survivor into the vacated slot.
		for (const exclusive of focus.exclusive) {
			const exclusiveFocus = focuses[exclusive];
			if (
				exclusive === focus.id ||
				exclusiveFocus === undefined ||
				exclusiveFocus.file !== filePath
			) {
				continue;
			}
			const key = pairKey(focus.id, exclusive);
			if (reportedPairs.has(key)) {
				continue;
			}
			reportedPairs.add(key);
			const exclusivePosition = positions.get(exclusive);
			if (
				exclusivePosition !== undefined &&
				exclusivePosition.y !== position.y
			) {
				warnings.push({
					text: localize(
						"focustree.warnings.exclusivenotsamey",
						"Mutually exclusive focuses {0} and {1} are not on the same row.",
						focus.id,
						exclusive,
					),
					source: focus.id,
					relatedSources: [exclusive],
				});
			}
		}
	}

	// Focuses stacked on the exact same resolved position collapse into one warning each, so a
	// pile of focuses on one spot emits a single line instead of one per pair.
	const stacks = new Map<string, string[]>();
	for (const { focus, position } of entries) {
		const key = `${position.x}\u0001${position.y}`;
		const stack = stacks.get(key);
		if (stack === undefined) {
			stacks.set(key, [focus.id]);
		} else {
			stack.push(focus.id);
		}
	}
	for (const stack of stacks.values()) {
		const first = stack[0];
		if (stack.length > 1 && first !== undefined) {
			warnings.push({
				text: localize(
					"focustree.warnings.sameposition",
					"Focuses {0} share the same position, so their icons overlap.",
					stack.join(", "),
				),
				source: first,
				relatedSources: stack.slice(1),
			});
		}
	}

	// Focus icons span two grid columns, so the remaining same-row pairs need at least two X
	// units between them or the sprites overlap. Same-position pairs are covered by the stacks.
	for (let i = 0; i < entries.length; i++) {
		const entryA = entries[i];
		if (entryA === undefined) {
			continue;
		}
		for (let j = i + 1; j < entries.length; j++) {
			const entryB = entries[j];
			if (entryB === undefined) {
				continue;
			}
			if (
				entryA.position.y !== entryB.position.y ||
				entryA.position.x === entryB.position.x
			) {
				continue;
			}
			if (Math.abs(entryA.position.x - entryB.position.x) < 2) {
				warnings.push({
					text: localize(
						"focustree.warnings.overlap",
						"Focuses {0} and {1} are less than 2 apart on the same row, so their icons overlap.",
						entryA.focus.id,
						entryB.focus.id,
					),
					source: entryA.focus.id,
					relatedSources: [entryB.focus.id],
				});
			}
		}
	}
}

function validateRelativePositionId(
	focuses: Record<string, Focus>,
	warnings: FocusWarning[],
	reportMissingTarget: boolean,
) {
	const relativePositionId: Record<string, Focus | undefined> = {};
	const relativePositionIdChain: string[] = [];
	const circularReported: Record<string, boolean> = {};

	for (const focus of Object.values(focuses)) {
		if (focus.relativePositionId === undefined) {
			continue;
		}

		if (!(focus.relativePositionId in focuses)) {
			if (reportMissingTarget) {
				warnings.push({
					text: localize(
						"focustree.warnings.relativepositionidnotexist",
						"Relative position ID of focus {0} not exist: {1}.",
						focus.id,
						focus.relativePositionId,
					),
					source: focus.id,
				});
			}
			continue;
		}

		relativePositionIdChain.length = 0;
		relativePositionId[focus.id] = focuses[focus.relativePositionId];
		let currentFocus: Focus | undefined = focus;
		while (currentFocus) {
			if (circularReported[currentFocus.id]) {
				break;
			}

			relativePositionIdChain.push(currentFocus.id);
			const nextFocus: Focus | undefined = relativePositionId[currentFocus.id];
			if (nextFocus && relativePositionIdChain.includes(nextFocus.id)) {
				relativePositionIdChain.forEach((r) => (circularReported[r] = true));
				relativePositionIdChain.push(nextFocus.id);
				warnings.push({
					text: localize(
						"focustree.warnings.relativepositioncircularref",
						"There're circular reference in relative position ID of these focuses: {0}.",
						relativePositionIdChain.join(" -> "),
					),
					source: focus.id,
				});
				break;
			}
			currentFocus = nextFocus;
		}
	}
}

function nodeValueToString(value: Node["value"]): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	return isSymbolNode(value) ? value.name : undefined;
}

/**
 * Reads bare focus ids out of a raw node list. The plain string schema cannot express a block
 * value (it converts via convertString to undefined), so both a prerequisite/mutually_exclusive
 * OR block and a focus_tree's shared_focus references are kept raw and walked here. Both the
 * single-symbol form (OR = focus_a, shared_focus = SH_a) and the block forms are accepted:
 * OR = { focus_a focus_b }, OR = { focus = focus_a focus = focus_b }, shared_focus = { SH_a SH_b }.
 */
export function extractOrListIds(orList: (Raw | undefined)[]): string[] {
	return flatten(
		orList
			.map((v) => v?._raw)
			.filter((v): v is Node => v !== undefined)
			.map((node) => {
				const value = node.value;
				if (Array.isArray(value)) {
					return value
						.map((child) =>
							child.name === "focus"
								? nodeValueToString(child.value)
								: child.name,
						)
						.filter((v): v is string => typeof v === "string");
				}
				const single = nodeValueToString(value);
				return single !== undefined ? [single] : [];
			}),
	);
}

function parseFocusIcon(
	nodes: Node[],
	constants: {},
	conditionExprs: ConditionItem[],
): FocusIconWithCondition[] {
	return flatten(
		nodes.map((n) => parseSingleFocusIcon(n, constants, conditionExprs)),
	);
}

function parseSingleFocusIcon(
	node: Node,
	constants: {},
	conditionExprs: ConditionItem[],
): FocusIconWithCondition[] {
	// Simple form: icon = GFX_focus_x
	const stringResult = convertNodeToJson<string>(node, "string", constants);
	if (stringResult) {
		return [{ icon: stringResult, condition: true }];
	}

	const children = Array.isArray(node.value) ? node.value : [];

	// Old block form: icon = { trigger = { ... }  value = GFX_focus_x }
	if (children.some((c) => c.name === "value")) {
		const iconWithCondition = convertNodeToJson<FocusIconDef>(
			node,
			focusIconSchema,
			constants,
		);
		return [
			{
				icon: iconWithCondition.value,
				condition: iconWithCondition.trigger
					? extractConditionValue(
							iconWithCondition.trigger._raw.value,
							countryScope,
							conditionExprs,
						).condition
					: true,
			},
		];
	}

	// New block form (HOI4 1.19+): icon = { GFX_focus_x = { <triggers> }  GFX_focus_y = yes }
	// Each child names a GFX sprite; a block value holds its triggers, `= yes` marks the default.
	// Source order is preserved so the first matching condition wins on the client (the `= yes`
	// default is conventionally last and always matches).
	return children
		.filter((c): c is Node & { name: string } => c.name !== null)
		.map((c) =>
			Array.isArray(c.value)
				? {
						icon: c.name,
						condition: extractConditionValue(
							c.value,
							countryScope,
							conditionExprs,
						).condition,
					}
				: { icon: c.name, condition: true },
		);
}
