import { Node, NodeValue, SymbolNode } from "./hoiparser";
import { Raw, isSymbolNode } from "./schema";
import { ModifierPair } from "../previewdef/sharedpayload";

// Reading the inside of a block the schema kept as `raw`.
//
// Once a block is declared "raw" the converter stops and hands back the parse node, and whoever
// wanted it has to walk it. Ideas, decisions and characters all want the same four things out of
// one -- its children, a scalar, a boolean, and a `modifier`-shaped list of key/value pairs -- and
// the idea and decision schemas each carried their own byte-identical copy of them before this
// file existed.

// Keys that sit inside a `modifier` block without being modifiers: they name a localisation key to
// print, and rendering them as "Custom Modifier Tooltip: some_tt_key" would be noise on every card
// that has one -- which in Millennium Dawn is hundreds of them.
const notModifiers = new Set(["custom_modifier_tooltip", "custom_effect_tooltip"]);

export function childNodes(node: Node): Node[] {
	return Array.isArray(node.value) ? node.value : [];
}

export function readScalar(value: NodeValue): number | string | boolean | undefined {
	if (typeof value === "number" || typeof value === "string") {
		return value;
	}
	if (isSymbolNode(value)) {
		const name = (value as SymbolNode).name;
		if (name === "yes") {
			return true;
		}
		if (name === "no") {
			return false;
		}
		// A `@constant` or a variable reference: keep the token so the reader at least sees which
		// one was written, rather than the line disappearing.
		return name;
	}
	return undefined;
}

export function readBoolean(value: NodeValue): boolean | undefined {
	const scalar = readScalar(value);
	return typeof scalar === "boolean" ? scalar : undefined;
}

/**
 * The `key = value` lines directly inside a block, as modifier pairs. Nested blocks are dropped:
 * they have no value to render, and a `modifier` nested inside an `ai_will_do` weight is not a
 * modifier at all.
 */
export function readModifierPairs(raw: Raw | undefined): ModifierPair[] {
	return raw ? readModifierPairsFromNode(raw._raw) : [];
}

export function readModifierPairsFromNode(node: Node): ModifierPair[] {
	const result: ModifierPair[] = [];
	if (!Array.isArray(node.value)) {
		return result;
	}

	for (const child of node.value) {
		if (!child.name || Array.isArray(child.value)) {
			continue;
		}
		if (notModifiers.has(child.name.toLowerCase())) {
			continue;
		}
		const value = readScalar(child.value);
		if (value !== undefined) {
			result.push({ key: child.name, value });
		}
	}

	return result;
}

export function hasContent(raw: Raw | undefined): boolean {
	return raw !== undefined && Array.isArray(raw._raw.value) && raw._raw.value.length > 0;
}
