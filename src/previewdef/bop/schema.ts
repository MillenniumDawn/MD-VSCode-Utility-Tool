import { Node, Token, resolveScriptVariables } from "../../hoiformat/hoiparser";
import { childNodes, readModifierPairsFromNode, readScalar } from "../../hoiformat/rawblock";
import { ModifierPair } from "../sharedpayload";

// A balance of power file, read the way common/bop is written:
//
//   <bop_id> = {
//       initial_value = 0.25
//       left_side = <side_id>
//       right_side = <side_id>
//       decision_category = <category>
//       range = { id min max modifier = { } on_activate = { } on_deactivate = { } }
//       side = { id icon range = { ... } range = { ... } }
//       side = { ... }
//   }
//
// The centre `range` is optional, a side carries any number of ranges in no fixed order, and
// vanilla defines more sides than the two named in left_side / right_side, which set_power_balance
// swaps in later. Every one of those is kept.

export interface HOIBopRange {
	id: string;
	min: number;
	max: number;
	modifiers: ModifierPair[];
	// `custom_modifier_tooltip` lines inside the `modifier` block: localisation keys the game prints
	// under the modifiers.
	customTooltips: string[];
	hasOnActivate: boolean;
	hasOnDeactivate: boolean;
	token: Token | undefined;
}

export interface HOIBopSide {
	id: string;
	icon: string | undefined;
	ranges: HOIBopRange[];
	token: Token | undefined;
}

export interface HOIBop {
	id: string;
	// How many BoPs with the same id came before this one in the file. The game keeps the last, but
	// the preview draws every one, so the payload keys on id and occurrence together.
	occurrence: number;
	initialValue: number;
	leftSide: string | undefined;
	rightSide: string | undefined;
	decisionCategory: string | undefined;
	centreRange: HOIBopRange | undefined;
	sides: HOIBopSide[];
	token: Token | undefined;
	file: string;
}

export interface HOIBopFile {
	bops: HOIBop[];
}

export function getBopsFromFile(node: Node, file: string): HOIBopFile {
	const root = resolveScriptVariables(node);
	const bops: HOIBop[] = [];
	const seen = new Map<string, number>();

	for (const child of childNodes(root)) {
		if (!child.name || child.name.startsWith("@") || !Array.isArray(child.value)) {
			continue;
		}
		const occurrence = seen.get(child.name) ?? 0;
		seen.set(child.name, occurrence + 1);
		bops.push(readBop(child, occurrence, file));
	}

	return { bops };
}

function readBop(node: Node, occurrence: number, file: string): HOIBop {
	const bop: HOIBop = {
		id: node.name ?? "",
		occurrence,
		initialValue: 0,
		leftSide: undefined,
		rightSide: undefined,
		decisionCategory: undefined,
		centreRange: undefined,
		sides: [],
		token: node.nameToken ?? undefined,
		file,
	};

	for (const child of childNodes(node)) {
		switch (child.name?.toLowerCase()) {
			case "initial_value":
				bop.initialValue = readNumber(child) ?? 0;
				break;
			case "left_side":
				bop.leftSide = readString(child);
				break;
			case "right_side":
				bop.rightSide = readString(child);
				break;
			case "decision_category":
				bop.decisionCategory = readString(child);
				break;
			case "range":
				// The game allows one centre range; a second one would be a mistake in the file, and the
				// first is what it reads.
				bop.centreRange ??= readRange(child);
				break;
			case "side":
				bop.sides.push(readSide(child));
				break;
		}
	}

	return bop;
}

function readSide(node: Node): HOIBopSide {
	const side: HOIBopSide = {
		id: "",
		icon: undefined,
		ranges: [],
		token: node.nameToken ?? undefined,
	};

	for (const child of childNodes(node)) {
		switch (child.name?.toLowerCase()) {
			case "id":
				side.id = readString(child) ?? "";
				break;
			case "icon":
				side.icon = readString(child);
				break;
			case "range":
				side.ranges.push(readRange(child));
				break;
		}
	}

	return side;
}

function readRange(node: Node): HOIBopRange {
	const range: HOIBopRange = {
		id: "",
		min: 0,
		max: 0,
		modifiers: [],
		customTooltips: [],
		hasOnActivate: false,
		hasOnDeactivate: false,
		token: node.nameToken ?? undefined,
	};

	for (const child of childNodes(node)) {
		switch (child.name?.toLowerCase()) {
			case "id":
				range.id = readString(child) ?? "";
				break;
			case "min":
				range.min = readNumber(child) ?? 0;
				break;
			case "max":
				range.max = readNumber(child) ?? 0;
				break;
			case "modifier":
				range.modifiers.push(...readModifierPairsFromNode(child));
				for (const line of childNodes(child)) {
					if (line.name?.toLowerCase() === "custom_modifier_tooltip") {
						const key = readString(line);
						if (key) {
							range.customTooltips.push(key);
						}
					}
				}
				break;
			case "on_activate":
				range.hasOnActivate = true;
				break;
			case "on_deactivate":
				range.hasOnDeactivate = true;
				break;
		}
	}

	return range;
}

function readString(node: Node): string | undefined {
	const value = readScalar(node.value);
	return value === undefined || typeof value === "boolean" ? undefined : String(value);
}

function readNumber(node: Node): number | undefined {
	const value = readScalar(node.value);
	if (typeof value === "number") {
		return value;
	}
	if (typeof value === "string") {
		const parsed = parseFloat(value);
		return isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}
