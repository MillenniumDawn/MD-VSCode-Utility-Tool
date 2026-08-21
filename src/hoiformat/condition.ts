import { Node, NodeValue } from "./hoiparser";
import { nodeToString } from "./tostring";
import { countryScope, Scope, tryMoveScope } from "./scope";

export type ConditionFolderType = "and" | "or" | "ornot" | "andnot";
export type ConditionComplexExpr =
	| ConditionFolder
	| ConditionAmountFolder
	| ConditionItem
	| boolean;

export interface ConditionItem {
	scopeName: string;
	nodeContent: string;
}

export interface ConditionFolder {
	type: ConditionFolderType;
	items: ConditionComplexExpr[];
}

export interface ConditionAmountFolder {
	type: "count";
	amount: number;
	items: ConditionComplexExpr[];
}

export interface ConditionValue {
	condition: ConditionComplexExpr;
	exprs: ConditionItem[];
}

/**
 * Identity of a condition leaf. A ConditionItem is two strings and nothing else, so comparing
 * them as strings is exactly as strict as a deep compare and does not walk anything. The same
 * `scopeName`/`nodeContent` pairing is what event/schema.ts already dedupes on.
 */
function conditionItemKey(item: ConditionItem): string {
	return item.scopeName + "\u0000" + item.nodeContent;
}

/*
 * The expression accumulator is threaded through a whole file -- every focus, decision or event
 * in it pushes into one array -- and membership used to be a lodash `isEqual` scan of everything
 * accumulated so far. That made building the list quadratic in the number of distinct conditions
 * a file holds: on a 600-focus tree with per-focus triggers it ran for well over a second, and
 * doubling the focus count quadrupled it.
 *
 * The keys are cached against the array itself rather than passed around, so the exported
 * signatures do not change. `size !== length` catches an array that was modified by someone
 * else and falls back to rebuilding, which is the linear scan this replaced -- never worse.
 */
const seenKeyCache = new WeakMap<ConditionItem[], Set<string>>();

function seenKeysFor(result: ConditionItem[]): Set<string> {
	const cached = seenKeyCache.get(result);
	if (cached !== undefined && cached.size === result.length) {
		return cached;
	}

	const keys = new Set(result.map(conditionItemKey));
	seenKeyCache.set(result, keys);
	return keys;
}

export function extractConditionValue(
	nodeValue: NodeValue,
	scope: Scope,
	exprs: ConditionItem[] = [],
): ConditionValue {
	const condition = simplifyCondition(
		extractConditionFolder(nodeValue, [scope]),
	);
	exprs = extractConditionalExprs(condition, exprs);
	return {
		condition,
		exprs,
	};
}

export function extractConditionValues(
	nodeValue: NodeValue[],
	scope: Scope,
	exprs: ConditionItem[] = [],
): ConditionValue {
	const condition = simplifyCondition({
		type: "and",
		items: nodeValue.map((nv) => extractConditionFolder(nv, [scope])),
	});
	exprs = extractConditionalExprs(condition, exprs);
	return {
		condition,
		exprs,
	};
}

export function extractConditionFolder(
	nodeValue: NodeValue,
	scopeStack: Scope[],
	type: ConditionFolderType | "count" = "and",
	excludedKeys: string[] | undefined = undefined,
	amount: number = 0,
): ConditionFolder | ConditionAmountFolder {
	if (!Array.isArray(nodeValue)) {
		return type === "count" ? { type, amount, items: [] } : { type, items: [] };
	}

	const items: ConditionComplexExpr[] = [];
	const currentScope = scopeStack[scopeStack.length - 1] ?? countryScope;
	let ifItem: ConditionFolder | undefined = undefined;
	let ifItemHasElse = false;

	for (const child of nodeValue) {
		let keepIfItem = false;

		let childName = child.name?.toLowerCase().trim();

		if (excludedKeys && childName && excludedKeys.includes(childName)) {
			continue;
		}

		if (childName === "and" || childName === "hidden_trigger") {
			items.push(extractConditionFolder(child.value, scopeStack));
		} else if (childName === "custom_trigger_tooltip") {
			items.push(
				extractConditionFolder(child.value, scopeStack, "and", ["tooltip"]),
			);
		} else if (childName === "or") {
			items.push(extractConditionFolder(child.value, scopeStack, "or"));
		} else if (childName === "not") {
			items.push(extractConditionFolder(child.value, scopeStack, "ornot"));
		} else if (childName === "if") {
			if (Array.isArray(child.value)) {
				const limit = child.value.find((v) => v.name === "limit");
				if (limit) {
					ifItem = handleIf(child, limit, scopeStack);
					keepIfItem = true;
					ifItemHasElse = false;

					const elseifs = child.value.filter((v) => v.name === "else_if");
					for (const elseif of elseifs) {
						handleElseIf(elseif, ifItem, scopeStack);
						keepIfItem = false;
					}

					const els = child.value.find((v) => v.name === "else");
					if (els) {
						handleElse(els, ifItem, scopeStack);
						keepIfItem = false;
						ifItemHasElse = true;
					}
				}
			}
		} else if (childName === "else_if") {
			if (ifItem) {
				handleElseIf(child, ifItem, scopeStack);
				keepIfItem = true;
			}
		} else if (childName === "else") {
			if (ifItem) {
				handleElse(child, ifItem, scopeStack);
				keepIfItem = false;
				ifItemHasElse = true;
			}
		} else if (childName === "always") {
			if (
				typeof child.value === "object" &&
				child.value &&
				"name" in child.value
			) {
				items.push(child.value.name.toLowerCase() === "yes");
			} else if (typeof child.value === "string") {
				items.push(child.value.toLowerCase() === "yes");
			}
		} else if (childName === "count_triggers") {
			if (Array.isArray(child.value)) {
				const amount = child.value.find((v) => v.name === "amount");
				if (amount && typeof amount.value === "number") {
					items.push(
						extractConditionFolder(
							child.value,
							scopeStack,
							"count",
							["amount"],
							amount.value,
						),
					);
				}
			}
		} else if (tryMoveScope(child, scopeStack, "condition")) {
			items.push(extractConditionFolder(child.value, scopeStack));
			scopeStack.pop();
		} else {
			items.push({
				scopeName: currentScope.scopeName,
				nodeContent: nodeToString(child),
			});
		}

		if (!keepIfItem) {
			if (ifItem) {
				if (!ifItemHasElse) {
					handleElse(null, ifItem, []);
				}
				items.push(ifItem);
			}
			ifItem = undefined;
		}
	}

	if (ifItem) {
		if (!ifItemHasElse) {
			handleElse(null, ifItem, []);
		}
		items.push(ifItem);
	}

	if (type === "count") {
		return { type, amount, items };
	}
	return { type, items };
}

export function applyCondition(
	condition: ConditionComplexExpr,
	trueExprs: ConditionItem[],
): boolean {
	if (typeof condition === "boolean") {
		return condition;
	}

	if (!("items" in condition)) {
		// Membership, not structural equality: a leaf is true when the same scope/content pair is
		// in the true list. Scanning that list per leaf made toggling one condition in a preview
		// cost (leaves x true exprs) deep compares.
		return seenKeysFor(trueExprs).has(conditionItemKey(condition));
	}

	if (condition.type === "count") {
		return (
			condition.items.filter((item) => applyCondition(item, trueExprs))
				.length >= condition.amount
		);
	}

	let ifSubConditionIs: boolean;
	let resultIs: boolean;
	let otherwise: boolean;
	switch (condition.type) {
		case "and":
			ifSubConditionIs = false;
			resultIs = false;
			otherwise = true;
			break;
		case "or":
			ifSubConditionIs = true;
			resultIs = true;
			otherwise = false;
			break;
		case "andnot":
			ifSubConditionIs = false;
			resultIs = true;
			otherwise = false;
			break;
		case "ornot":
			ifSubConditionIs = true;
			resultIs = false;
			otherwise = true;
			break;
	}

	for (const item of condition.items) {
		if (ifSubConditionIs === applyCondition(item, trueExprs)) {
			return resultIs;
		}
	}

	return otherwise;
}

function handleIf(
	ifNode: Node,
	limit: Node,
	scopeStack: Scope[],
): ConditionFolder {
	return {
		type: "or",
		items: [
			{
				type: "and",
				items: [
					extractConditionFolder(limit.value, scopeStack, "and"),
					extractConditionFolder(ifNode.value, scopeStack, "and", [
						"limit",
						"else_if",
						"else",
					]),
				],
			},
		],
	};
}

function handleElseIf(
	elseIfNode: Node,
	ifItem: ConditionFolder,
	scopeStack: Scope[],
) {
	if (!Array.isArray(elseIfNode.value)) {
		return;
	}
	const elseiflimit = elseIfNode.value.find((v) => v.name === "limit");
	if (elseiflimit) {
		const lastItemItems = (
			ifItem.items[ifItem.items.length - 1] as ConditionFolder
		).items;
		const newItem: ConditionComplexExpr[] = [
			...lastItemItems.slice(0, lastItemItems.length - 2),
			{
				...(lastItemItems[lastItemItems.length - 2] as ConditionFolder),
				type: "andnot",
			},
			extractConditionFolder(elseiflimit.value, scopeStack, "and"),
			extractConditionFolder(elseIfNode.value, scopeStack, "and", [
				"limit",
				"else_if",
				"else",
			]),
		];
		ifItem.items.push({
			type: "and",
			items: newItem,
		});
	}
}

function handleElse(
	elseNode: Node | null,
	ifItem: ConditionFolder,
	scopeStack: Scope[],
) {
	if (elseNode === null || Array.isArray(elseNode.value)) {
		const lastItemItems = (
			ifItem.items[ifItem.items.length - 1] as ConditionFolder
		).items;
		const newItem: ConditionComplexExpr[] = [
			...lastItemItems.slice(0, lastItemItems.length - 2),
			{
				...(lastItemItems[lastItemItems.length - 2] as ConditionFolder),
				type: "andnot",
			},
		];
		if (elseNode !== null) {
			newItem.push(
				extractConditionFolder(elseNode.value, scopeStack, "and", [
					"limit",
					"else_if",
					"else",
				]),
			);
		}
		ifItem.items.push({
			type: "and",
			items: newItem,
		});
	}
}

export function simplifyCondition(
	condition: ConditionComplexExpr,
): ConditionComplexExpr {
	if (typeof condition === "boolean" || !("items" in condition)) {
		return condition;
	}

	const simplifiedItems: ConditionFolder["items"] = [];
	let amount = condition.type === "count" ? condition.amount : 0;
	for (const item of condition.items) {
		const simplified = simplifyCondition(item);
		if (typeof simplified === "boolean") {
			if (simplified) {
				if (condition.type === "or") {
					return true;
				} else if (condition.type === "ornot") {
					return false;
				} else if (condition.type === "count") {
					amount--;
				}
			} else {
				if (condition.type === "and") {
					return false;
				} else if (condition.type === "andnot") {
					return true;
				}
			}
		} else {
			simplifiedItems.push(simplified);
		}
	}

	if (simplifiedItems.length === 0) {
		return condition.type === "and" || condition.type === "ornot";
	}

	if (condition.type === "count") {
		if (amount <= 0) {
			return true;
		} else if (amount > simplifiedItems.length) {
			return false;
		} else if (amount === simplifiedItems.length) {
			return simplifyCondition({ type: "and", items: simplifiedItems });
		}
	}

	if (simplifiedItems.length === 1) {
		const onlyItem = simplifiedItems[0];
		if (onlyItem === undefined) {
			return condition;
		}
		if (condition.type === "and" || condition.type === "or") {
			return simplifyCondition(onlyItem);
		}

		if (condition.type === "andnot") {
			return simplifyCondition({ type: "ornot", items: simplifiedItems });
		}

		if (condition.type === "ornot") {
			const child = simplifiedItems[0];
			if (
				typeof child === "object" &&
				"items" in child &&
				(child.type === "andnot" || child.type === "ornot")
			) {
				return simplifyCondition({
					type: child.type === "andnot" ? "and" : "or",
					items: child.items,
				});
			}
		}
	}

	if (condition.type === "count") {
		return {
			...condition,
			amount,
			items: simplifiedItems,
		};
	}

	return {
		...condition,
		items: simplifiedItems,
	};
}

// Combines two conditions that both have to hold. Nested `and` folders are flattened and an item
// already present is dropped, so folding a guard onto an expression that already carries it -- which
// is what happens when an enclosing `if` is preserved into a `random_list` branch and then folded
// again while collecting the calls inside it -- yields the guard once rather than twice.
export function andCondition(
	a: ConditionComplexExpr,
	b: ConditionComplexExpr,
): ConditionComplexExpr {
	if (a === true) {
		return b;
	}
	if (b === true) {
		return a;
	}

	const items: ConditionComplexExpr[] = [];
	// An item can be a whole folder here, not just a leaf, so identity comes from the serialiser
	// this module already has rather than from the two-string leaf key.
	const seen = new Set<string>();
	const push = (condition: ConditionComplexExpr): void => {
		if (condition === true) {
			return;
		}
		if (typeof condition === "object" && "items" in condition && condition.type === "and") {
			condition.items.forEach(push);
			return;
		}
		const key = conditionToString(condition);
		if (!seen.has(key)) {
			seen.add(key);
			items.push(condition);
		}
	};
	push(a);
	push(b);

	return simplifyCondition({ type: "and", items });
}

export function extractConditionalExprs(
	condition: ConditionComplexExpr,
	result: ConditionItem[] = [],
): ConditionItem[] {
	return extractConditionalExprsInto(condition, result, seenKeysFor(result));
}

function extractConditionalExprsInto(
	condition: ConditionComplexExpr,
	result: ConditionItem[],
	seen: Set<string>,
): ConditionItem[] {
	if (typeof condition === "boolean") {
		return result;
	}

	if (!("items" in condition)) {
		const key = conditionItemKey(condition);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(condition);
		}
		return result;
	}

	for (const item of condition.items) {
		extractConditionalExprsInto(item, result, seen);
	}

	return result;
}

export function conditionToString(condition: ConditionComplexExpr): string {
	if (typeof condition === "boolean") {
		return condition.toString();
	}

	if (!("items" in condition)) {
		return (
			(condition.scopeName !== "" ? "[" + condition.scopeName + "]" : "") +
			condition.nodeContent
		);
	}

	return (
		condition.type +
		"(" +
		condition.items.map(conditionToString).join(", ") +
		")" +
		(condition.type === "count" ? " == " + condition.amount : "")
	);
}
