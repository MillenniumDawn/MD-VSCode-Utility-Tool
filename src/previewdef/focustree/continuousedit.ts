import { parseHoi4File, Node, resolveScriptVariables } from "../../hoiformat/hoiparser";
import { readScalar } from "../../hoiformat/rawblock";
import { localize } from "../../util/i18n";

export interface ContinuousFocusEdit {
	start: number;
	end: number;
	newText: string;
}

/**
 * The text edit that sets continuous_focus_position of one focus_tree to (x, y). The tree is the
 * one whose `focus_tree` key starts at `treeStart` and still has the id the preview drew.
 * If another tree took that position, there is nothing safe to edit.
 */
export function computeContinuousFocusEdit(
	text: string,
	treeStart: number,
	treeId: string,
	x: number,
	y: number,
): ContinuousFocusEdit | undefined {
	let root: Node;
	try {
		root = resolveScriptVariables(parseHoi4File(text));
	} catch {
		return undefined;
	}

	if (!Array.isArray(root.value)) {
		return undefined;
	}

	const tree = root.value.find(
		(n) =>
			n.name?.toLowerCase() === "focus_tree" &&
			n.nameToken?.start === treeStart,
	);
	if (!tree || !Array.isArray(tree.value) || !tree.valueStartToken) {
		return undefined;
	}
	const id = tree.value.find((n) => n.name?.toLowerCase() === "id");
	if ((id ? readScalar(id.value) : localize("focustree.ananymous", "<Anonymous focus tree>")) !== treeId) {
		return undefined;
	}

	const block = `{ x = ${Math.round(x)} y = ${Math.round(y)} }`;
	const existing = tree.value.find(
		(n) => n.name?.toLowerCase() === "continuous_focus_position",
	);
	if (existing) {
		if (existing.valueStartToken && existing.valueEndToken) {
			return {
				start: existing.valueStartToken.start,
				end: existing.valueEndToken.end,
				newText: block,
			};
		}
		return undefined;
	}

	const openEnd = tree.valueStartToken.end;
	const indent = childIndent(text, tree);
	const inlineEmpty = tree.value.length === 0 && tree.valueEndToken &&
		!text.slice(openEnd, tree.valueEndToken.start).includes("\n");
	return {
		start: openEnd,
		end: openEnd,
		newText: `\n${indent}continuous_focus_position = ${block}${inlineEmpty ? `\n${indent.slice(0, -1)}` : ""}`,
	};
}

// The indent the tree's first child is written with, so the inserted line lines up with it.
function childIndent(text: string, tree: Node): string {
	const first = Array.isArray(tree.value) ? tree.value[0] : undefined;
	const firstStart = first?.nameToken?.start ?? first?.valueStartToken?.start;
	if (firstStart !== undefined) {
		const lineStart = text.lastIndexOf("\n", firstStart - 1) + 1;
		const indent = text.substring(lineStart, firstStart);
		if (/^[ \t]*$/.test(indent) && lineStart > (tree.valueStartToken?.end ?? 0)) {
			return indent;
		}
	}

	const treeLineStart = text.lastIndexOf("\n", (tree.nameToken?.start ?? 0) - 1) + 1;
	const treeIndent = /^[ \t]*/.exec(text.substring(treeLineStart))?.[0] ?? "";
	return treeIndent + "\t";
}
