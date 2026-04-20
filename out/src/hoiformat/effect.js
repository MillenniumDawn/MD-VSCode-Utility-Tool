"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractEffectValue = extractEffectValue;
const condition_1 = require("./condition");
const scope_1 = require("./scope");
const tostring_1 = require("./tostring");
function extractEffectValue(nodeValue, scope, excludedKeys = undefined) {
    const effect = simplifyEffect(extractEffectByCondition(nodeValue, [scope], true, [], excludedKeys));
    return {
        effect,
    };
}
function extractEffectByCondition(nodeValue, scopeStack, condition = true, result = [], excludedKeys = undefined) {
    if (!Array.isArray(nodeValue)) {
        return { condition: true, items: result };
    }
    const currentScope = scopeStack[scopeStack.length - 1];
    const items = [];
    let ifItem = undefined;
    for (const child of nodeValue) {
        let keepIfItem = false;
        let childName = child.name?.toLowerCase().trim();
        if (excludedKeys && childName && excludedKeys.includes(childName)) {
            continue;
        }
        if (childName === 'hidden_effect') {
            extractEffectByCondition(child.value, scopeStack, condition, result);
        }
        else if (childName === 'random_list') {
            if (Array.isArray(child.value)) {
                const randomListItems = child.value.map(n => {
                    const possibility = parseInt(n.name ?? '0');
                    const effect = extractEffectByCondition(n.value, scopeStack, true, [], ['modifier']);
                    return {
                        possibility,
                        effect,
                    };
                });
                result.push({ items: randomListItems });
            }
        }
        else if (childName === 'if') {
            if (Array.isArray(child.value)) {
                const limit = child.value.find(v => v.name === 'limit');
                if (limit) {
                    ifItem = handleIf(child, limit, scopeStack, condition, result);
                    keepIfItem = true;
                    const elseifs = child.value.filter(v => v.name === 'else_if');
                    for (const elseif of elseifs) {
                        handleElseIf(elseif, ifItem, scopeStack, result);
                        keepIfItem = false;
                    }
                    const els = child.value.find(v => v.name === 'else');
                    if (els) {
                        handleElse(els, ifItem, scopeStack, result);
                        keepIfItem = false;
                    }
                }
            }
        }
        else if (childName === 'else_if') {
            if (ifItem) {
                handleElseIf(child, ifItem, scopeStack, result);
                keepIfItem = true;
            }
        }
        else if (childName === 'else') {
            if (ifItem) {
                handleElse(child, ifItem, scopeStack, result);
                keepIfItem = false;
            }
        }
        else if ((0, scope_1.tryMoveScope)(child, scopeStack, 'effect')) {
            extractEffectByCondition(child.value, scopeStack, condition, result);
            scopeStack.pop();
        }
        else {
            items.push({
                scopeName: currentScope.scopeName,
                nodeContent: (0, tostring_1.nodeToString)(child),
                node: child,
            });
        }
        if (!keepIfItem) {
            ifItem = undefined;
        }
    }
    if (items.length > 0) {
        const existing = result.filter((r) => r !== null && 'condition' in r).find(r => r.condition === condition);
        if (existing) {
            existing.items.push(...items);
        }
        else {
            result.push({
                condition,
                items,
            });
        }
    }
    return { condition: true, items: result };
}
function handleIf(ifNode, limit, scopeStack, baseCondition, result) {
    const condition = {
        type: 'and',
        items: [
            baseCondition,
            (0, condition_1.extractConditionFolder)(limit.value, scopeStack, 'and'),
        ],
    };
    extractEffectByCondition(ifNode.value, scopeStack, (0, condition_1.simplifyCondition)(condition), result, ['limit', 'else_if', 'else']);
    return condition;
}
function handleElseIf(elseIfNode, ifItem, scopeStack, result) {
    if (!Array.isArray(elseIfNode.value)) {
        return;
    }
    const elseiflimit = elseIfNode.value.find(v => v.name === 'limit');
    if (elseiflimit) {
        const lastItemItems = ifItem.items;
        const newItems = [
            ...lastItemItems.slice(0, lastItemItems.length - 1),
            {
                ...lastItemItems[lastItemItems.length - 1],
                type: 'andnot',
            },
            (0, condition_1.extractConditionFolder)(elseiflimit.value, scopeStack, 'and'),
        ];
        ifItem.items = newItems;
        extractEffectByCondition(elseIfNode.value, scopeStack, (0, condition_1.simplifyCondition)(ifItem), result, ['limit', 'else_if', 'else']);
    }
}
function handleElse(elseNode, ifItem, scopeStack, result) {
    if (Array.isArray(elseNode.value)) {
        const lastItemItems = ifItem.items;
        const newItems = [
            ...lastItemItems.slice(0, ifItem.items.length - 1),
            {
                ...lastItemItems[ifItem.items.length - 1],
                type: 'andnot',
            },
        ];
        ifItem.items = newItems;
        extractEffectByCondition(elseNode.value, scopeStack, (0, condition_1.simplifyCondition)(ifItem), result, ['limit', 'else_if', 'else']);
    }
}
function simplifyEffect(effect) {
    if (effect === null) {
        return null;
    }
    if ('condition' in effect) {
        const items = effect.items.map(i => simplifyEffect(i)).filter(i => i !== null);
        if (items.length === 0) {
            return null;
        }
        if (effect.condition === true) {
            if (items.length === 1) {
                return simplifyEffect(items[0]);
            }
        }
        return {
            ...effect,
            items,
        };
    }
    else if (!('nodeContent' in effect)) {
        let items = effect.items.filter(i => i.possibility > 0);
        if (items.length === 0) {
            return null;
        }
        if (items.length === 1) {
            return simplifyEffect(items[0].effect);
        }
        items = items.map(i => ({ ...i, effect: simplifyEffect(i.effect) }));
        return {
            ...effect,
            items,
        };
    }
    else {
        return effect;
    }
}
//# sourceMappingURL=effect.js.map