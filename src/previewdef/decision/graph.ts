import { localisationIndex } from "../../util/featureflags";
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { localize } from "../../util/i18n";
import { formatModifiers } from "../../util/modifiers";
import { renderStandaloneWindow } from "../../util/hoi4gui/window";
import { HOIDecision, HOIDecisionCategoryRef } from "./schema";
import { DecisionsLoaderResult, decisionSpriteName } from "./loader";
import { HOIDecisionCategory } from "./categories";
import {
	DecisionEffectRef,
	DecisionGraphCategoryNode,
	DecisionGraphDecisionNode,
	DecisionGraphEdge,
	DecisionGraphNode,
	DecisionGraphPayload,
	DecisionIcon,
	DecisionScriptedGui,
	DecisionToolbarFlags,
	EffectTreeNode,
	LocText,
	NavTarget,
} from "./payload";

// Node ids are prefixed by kind so a category and a decision that share a name -- which the format
// allows, since the two live in different namespaces -- can never collide on the canvas.
const categoryId = (name: string) => `c:${name}`;
const decisionId = (id: string) => `d:${id}`;
const unresolvedId = (id: string) => `u:${id}`;

export async function buildDecisionGraphPayload(
	loadResult: DecisionsLoaderResult,
	styleTable: StyleTable,
): Promise<DecisionGraphPayload> {
	const nodes: DecisionGraphNode[] = [];
	const edges: DecisionGraphEdge[] = [];
	const roots: string[] = [];
	const effectBlocks: EffectTreeNode[][] = [];
	// Serialized block -> its index in effectBlocks, so interning stays linear in the file's size.
	const effectIndex = new Map<string, number>();

	// Every decision in the file, so a call can be told from one that leaves it. First definition
	// wins, matching how the game reads a duplicate key.
	const decisionsById = new Map<string, HOIDecision>();
	for (const category of loadResult.decisions.categories) {
		for (const decision of category.decisions) {
			if (!decisionsById.has(decision.id)) {
				decisionsById.set(decision.id, decision);
			}
		}
	}

	const seenCategories = new Set<string>();
	for (const category of loadResult.decisions.categories) {
		// A category written twice in one file -- Millennium Dawn splits a few across sections --
		// is one tab in game, so it is one node here and the second block's decisions hang off the
		// first.
		const id = categoryId(category.name);
		if (!seenCategories.has(category.name)) {
			seenCategories.add(category.name);
			nodes.push(
				await buildCategoryNode(category, loadResult.categories[category.name], loadResult, styleTable),
			);
			roots.push(id);
		}

		for (const decision of category.decisions) {
			nodes.push(
				await buildDecisionNode(decision, loadResult, styleTable, effectBlocks, effectIndex),
			);
			edges.push({
				from: id,
				to: decisionId(decision.id),
				structural: true,
				condition: true,
			});
		}
	}

	// The calls, and a placeholder for anything they name that this file does not define.
	const unresolved = new Set<string>();
	for (const decision of decisionsById.values()) {
		for (const call of decision.calls) {
			const target = decisionsById.has(call.target)
				? decisionId(call.target)
				: unresolvedId(call.target);
			if (!decisionsById.has(call.target) && !unresolved.has(call.target)) {
				unresolved.add(call.target);
				nodes.push({
					kind: "unresolved",
					id: target,
					decisionId: call.target,
					name: await localise(call.target),
				});
			}

			edges.push({
				from: decisionId(decision.id),
				to: target,
				structural: false,
				kind: call.kind,
				fromBlock: call.from,
				condition: call.condition,
				possibility: call.possibility,
			});
		}
	}

	return {
		roots,
		nodes,
		edges,
		conditionExprs: loadResult.decisions.conditionExprs,
		effectBlocks,
		toolbarFlags: toolbarFlagsOf(nodes, edges),
	};
}

async function buildCategoryNode(
	category: HOIDecisionCategoryRef,
	definition: HOIDecisionCategory | undefined,
	loadResult: DecisionsLoaderResult,
	styleTable: StyleTable,
): Promise<DecisionGraphCategoryNode> {
	const [name, desc] = await Promise.all([
		localise(category.name),
		localise(`${category.name}_desc`),
	]);

	return {
		kind: "category",
		id: categoryId(category.name),
		categoryKey: category.name,
		name,
		desc,
		icon: definition?.icon
			? await buildIcon(decisionSpriteName(definition.icon), loadResult, styleTable)
			: undefined,
		// `picture` is always written as a full sprite name, so it is not run through the prefixer.
		picture: definition?.picture
			? await buildIcon(definition.picture, loadResult, styleTable)
			: undefined,
		priority: definition?.priority,
		scriptedGui: await buildScriptedGui(definition, loadResult, styleTable),
		visibleWhenEmpty: definition?.visibleWhenEmpty ?? false,
		allowed: definition?.allowed ?? true,
		hasAllowed: definition?.hasAllowed ?? false,
		visible: definition?.visible ?? true,
		hasVisible: definition?.hasVisible ?? false,
		defined: definition !== undefined,
		// The definition is where the tab is described, so that is where clicking the card goes when
		// there is one; otherwise it goes to the category block in the previewed file.
		nav:
			navOf(definition?.token, definition?.file) ?? navOf(category.token, category.file),
	};
}

async function buildDecisionNode(
	decision: HOIDecision,
	loadResult: DecisionsLoaderResult,
	styleTable: StyleTable,
	effectBlocks: EffectTreeNode[][],
	effectIndex: Map<string, number>,
): Promise<DecisionGraphDecisionNode> {
	const [name, desc, modifiers] = await Promise.all([
		localise(decision.nameKey),
		localise(decision.descKey),
		formatModifiers(decision.modifiers, loadResult.modifierDefinitions),
	]);

	const effects: DecisionEffectRef[] = [];
	for (const block of decision.effectBlocks) {
		effects.push({
			name: block.name,
			ref: internEffects(block.effects, effectBlocks, effectIndex),
		});
	}

	// The game draws the first icon whose trigger holds, and the preview cannot evaluate a trigger,
	// so it draws the first one written and says how many there were.
	const firstIcon = decision.icons[0];

	return {
		kind: "decision",
		id: decisionId(decision.id),
		decisionId: decision.id,
		category: decision.category,
		name,
		desc,
		borrowsName: decision.hasNameOverride,
		icon: firstIcon
			? await buildIcon(decisionSpriteName(firstIcon.key), loadResult, styleTable)
			: undefined,
		iconCount: decision.icons.length,
		isMission: decision.isMission,
		daysMissionTimeout: decision.daysMissionTimeout,
		isGood: decision.isGood,
		selectableMission: decision.selectableMission,
		fireOnlyOnce: decision.fireOnlyOnce,
		badges: badgesOf(decision),
		modifiers,
		allowed: decision.allowed,
		hasAllowed: decision.hasAllowed,
		available: decision.available,
		hasAvailable: decision.hasAvailable,
		visible: decision.visible,
		hasVisible: decision.hasVisible,
		activation: decision.activation,
		hasActivation: decision.hasActivation,
		cancelTrigger: decision.cancelTrigger,
		hasCancelTrigger: decision.hasCancelTrigger,
		effects,
		nav: navOf(decision.token, decision.file),
	};
}

// Renders the window a `scripted_gui` category is drawn by, so the preview can show what the player
// actually sees instead of a list the game never draws. A name that resolves to no window still
// produces a badge -- the reader is told the category has a custom GUI and that it could not be
// found, which is more useful than silence.
async function buildScriptedGui(
	definition: HOIDecisionCategory | undefined,
	loadResult: DecisionsLoaderResult,
	styleTable: StyleTable,
): Promise<DecisionScriptedGui | undefined> {
	const name = definition?.scriptedGui;
	if (!name) {
		return undefined;
	}

	const def = loadResult.scriptedGuis[name];
	const windowName = def?.windowName;
	const resolved = windowName ? loadResult.guiWindows[windowName] : undefined;
	if (!resolved) {
		return { name, windowName };
	}

	const rendered = await renderStandaloneWindow(resolved.window, styleTable, loadResult.gfxFiles);

	return {
		name,
		windowName,
		// Wrapped at its own size and scaled by the webview, which is the only side that knows how
		// much room the card has.
		html: `<div class="dec-gui-window" style="width:${rendered.width}px;height:${rendered.height}px">${rendered.html}</div>`,
		nav: navOf(resolved.window._token, resolved.file),
	};
}

async function buildIcon(
	spriteName: string,
	loadResult: DecisionsLoaderResult,
	styleTable: StyleTable,
): Promise<DecisionIcon | undefined> {
	const sprite = await getSpriteByGfxName(spriteName, loadResult.gfxFiles);
	const image = sprite?.image;
	if (!image) {
		return undefined;
	}

	// Keyed on the sprite rather than the decision, so the hundreds of decisions sharing
	// GFX_decision_generic_decision share one rule instead of writing the same data URL each time.
	const styleKey = styleTable.style(
		"decision-icon-" + normalizeForStyle(spriteName),
		() => `
            background-image: url(${image.uri});
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        `,
	);

	return { styleKey, width: image.width, height: image.height };
}

function badgesOf(decision: HOIDecision): string[] {
	const badges: string[] = [];

	if (decision.customCostText) {
		badges.push(decision.customCostText);
	} else if (decision.cost !== undefined) {
		badges.push(localize("decisiontree.cost", "Cost {0}", decision.cost));
	}
	if (decision.daysRemove !== undefined) {
		badges.push(localize("decisiontree.daysremove", "Runs {0}d", decision.daysRemove));
	}
	if (decision.daysReEnable !== undefined) {
		badges.push(localize("decisiontree.daysreenable", "Cooldown {0}d", decision.daysReEnable));
	}
	if (decision.priority !== undefined) {
		badges.push(localize("decisiontree.priority", "Priority {0}", decision.priority));
	}
	if (decision.targets.isState) {
		badges.push(localize("decisiontree.statetarget", "State target"));
	}
	if (decision.targets.values.length > 0) {
		badges.push(
			localize("decisiontree.targets", "Targets: {0}", decision.targets.values.join(", ")),
		);
	}
	for (const array of decision.targets.arrays) {
		badges.push(localize("decisiontree.targets", "Targets: {0}", array));
	}
	if (decision.onMapMode) {
		badges.push(decision.onMapMode);
	}

	return badges;
}

// Every distinct effect block is stored once and referenced by index. Two decisions that do exactly
// the same thing -- which a generated set of them often does -- then cost one copy rather than two.
//
// Keyed through a Map rather than scanned: Millennium Dawn's decisions come to some 7700 distinct
// blocks, and re-serialising every stored block to compare against each new one would be quadratic
// in the size of the file.
function internEffects(
	effects: EffectTreeNode[],
	blocks: EffectTreeNode[][],
	index: Map<string, number>,
): number {
	const key = JSON.stringify(effects);
	const existing = index.get(key);
	if (existing !== undefined) {
		return existing;
	}
	blocks.push(effects);
	const ref = blocks.length - 1;
	index.set(key, ref);
	return ref;
}

export function toolbarFlagsOf(
	nodes: DecisionGraphNode[],
	edges: DecisionGraphEdge[],
): DecisionToolbarFlags {
	const decisions = nodes.filter((n): n is DecisionGraphDecisionNode => n.kind === "decision");
	const categories = nodes.filter((n): n is DecisionGraphCategoryNode => n.kind === "category");

	return {
		hasMissions: decisions.some((d) => d.isMission),
		hasDecisions: decisions.some((d) => !d.isMission),
		hasChains: edges.some((e) => !e.structural),
		hasEffects: decisions.some((d) => d.effects.length > 0),
		hasModifiers: decisions.some((d) => d.modifiers.length > 0),
		hasTargets: decisions.some((d) => d.badges.length > 0),
		hasScriptedGui: categories.some((c) => c.scriptedGui?.html !== undefined),
		hasConditions:
			decisions.some(
				(d) => d.hasAllowed || d.hasAvailable || d.hasVisible || d.hasActivation || d.hasCancelTrigger,
			) || categories.some((c) => c.hasAllowed || c.hasVisible),
		hasIcons: nodes.some((n) => n.kind !== "unresolved" && n.icon !== undefined),
		hasLocalisation: localisationIndex,
		hasUnresolvedScriptedGui: categories.some(
			(c) => c.scriptedGui !== undefined && c.scriptedGui.html === undefined,
		),
	};
}

async function localise(key: string): Promise<LocText> {
	// getLocalisedTextQuick echoes the key back when nothing resolves, which is exactly the fallback
	// the preview wants, so an unresolved key simply reads the same either way.
	const text = localisationIndex ? await getLocalisedTextQuick(key) : key;
	return { key, text: text ?? key };
}

function navOf(
	token: { start: number; end: number } | undefined,
	file: string | undefined,
): NavTarget | undefined {
	return token && file ? { start: token.start, end: token.end, file } : undefined;
}
