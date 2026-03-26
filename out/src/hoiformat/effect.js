"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractEffectValue = void 0;
const condition_1 = require("./condition");
const scope_1 = require("./scope");
const tostring_1 = require("./tostring");
function extractEffectValue(nodeValue, scope, excludedKeys = undefined) {
    const effect = simplifyEffect(extractEffectByCondition(nodeValue, [scope], true, [], excludedKeys));
    return {
        effect,
    };
}
exports.extractEffectValue = extractEffectValue;
function extractEffectByCondition(nodeValue, scopeStack, condition = true, result = [], excludedKeys = undefined) {
    var _a;
    if (!Array.isArray(nodeValue)) {
        return { condition: true, items: result };
    }
    const currentScope = scopeStack[scopeStack.length - 1];
    const items = [];
    let ifItem = undefined;
    for (const child of nodeValue) {
        let keepIfItem = false;
        let childName = (_a = child.name) === null || _a === void 0 ? void 0 : _a.toLowerCase().trim();
        if (excludedKeys && childName && excludedKeys.includes(childName)) {
            continue;
        }
        if (childName === 'hidden_effect') {
            extractEffectByCondition(child.value, scopeStack, condition, result);
        }
        else if (childName === 'random_list') {
            if (Array.isArray(child.value)) {
                const randomListItems = child.value.map(n => {
                    var _a;
                    const possibility = parseInt((_a = n.name) !== null && _a !== void 0 ? _a : '0');
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
            Object.assign(Object.assign({}, lastItemItems[lastItemItems.length - 1]), { type: 'andnot' }),
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
            Object.assign(Object.assign({}, lastItemItems[ifItem.items.length - 1]), { type: 'andnot' }),
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
        return Object.assign(Object.assign({}, effect), { items });
    }
    else if (!('nodeContent' in effect)) {
        let items = effect.items.filter(i => i.possibility > 0);
        if (items.length === 0) {
            return null;
        }
        if (items.length === 1) {
            return simplifyEffect(items[0].effect);
        }
        items = items.map(i => (Object.assign(Object.assign({}, i), { effect: simplifyEffect(i.effect) })));
        return Object.assign(Object.assign({}, effect), { items });
    }
    else {
        return effect;
    }
}
//# sourceMappingURL=effect.js.map