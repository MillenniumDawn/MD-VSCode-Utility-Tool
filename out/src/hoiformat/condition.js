"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conditionToString = exports.extractConditionalExprs = exports.simplifyCondition = exports.applyCondition = exports.extractConditionFolder = exports.extractConditionValues = exports.extractConditionValue = void 0;
const tostring_1 = require("./tostring");
const scope_1 = require("./scope");
const lodash_1 = require("lodash");
function extractConditionValue(nodeValue, scope, exprs = []) {
    const condition = simplifyCondition(extractConditionFolder(nodeValue, [scope]));
    exprs = extractConditionalExprs(condition, exprs);
    return {
        condition,
        exprs,
    };
}
exports.extractConditionValue = extractConditionValue;
function extractConditionValues(nodeValue, scope, exprs = []) {
    const condition = simplifyCondition({ type: 'and', items: nodeValue.map(nv => extractConditionFolder(nv, [scope])) });
    exprs = extractConditionalExprs(condition, exprs);
    return {
        condition,
        exprs,
    };
}
exports.extractConditionValues = extractConditionValues;
function extractConditionFolder(nodeValue, scopeStack, type = 'and', excludedKeys = undefined, amount = 0) {
    var _a;
    if (!Array.isArray(nodeValue)) {
        return type === 'count' ? { type, amount, items: [] } : { type, items: [] };
    }
    const items = [];
    const currentScope = scopeStack[scopeStack.length - 1];
    let ifItem = undefined;
    let ifItemHasElse = false;
    for (const child of nodeValue) {
        let keepIfItem = false;
        let childName = (_a = child.name) === null || _a === void 0 ? void 0 : _a.toLowerCase().trim();
        if (excludedKeys && childName && excludedKeys.includes(childName)) {
            continue;
        }
        if (childName === 'and' || childName === 'hidden_trigger') {
            items.push(extractConditionFolder(child.value, scopeStack));
        }
        else if (childName === 'custom_trigger_tooltip') {
            items.push(extractConditionFolder(child.value, scopeStack, 'and', ['tooltip']));
        }
        else if (childName === 'or') {
            items.push(extractConditionFolder(child.value, scopeStack, 'or'));
        }
        else if (childName === 'not') {
            items.push(extractConditionFolder(child.value, scopeStack, 'ornot'));
        }
        else if (childName === 'if') {
            if (Array.isArray(child.value)) {
                const limit = child.value.find(v => v.name === 'limit');
                if (limit) {
                    ifItem = handleIf(child, limit, scopeStack);
                    keepIfItem = true;
                    ifItemHasElse = false;
                    const elseifs = child.value.filter(v => v.name === 'else_if');
                    for (const elseif of elseifs) {
                        handleElseIf(elseif, ifItem, scopeStack);
                        keepIfItem = false;
                    }
                    const els = child.value.find(v => v.name === 'else');
                    if (els) {
                        handleElse(els, ifItem, scopeStack);
                        keepIfItem = false;
                        ifItemHasElse = true;
                    }
                }
            }
        }
        else if (childName === 'else_if') {
            if (ifItem) {
                handleElseIf(child, ifItem, scopeStack);
                keepIfItem = true;
            }
        }
        else if (childName === 'else') {
            if (ifItem) {
                handleElse(child, ifItem, scopeStack);
                keepIfItem = false;
                ifItemHasElse = true;
            }
        }
        else if (childName === 'always') {
            if (typeof child.value === 'object' && child.value && 'name' in child.value) {
                items.push(child.value.name.toLowerCase() === 'yes');
            }
            else if (typeof child.value === 'string') {
                items.push(child.value.toLowerCase() === 'yes');
            }
        }
        else if (childName === 'count_triggers') {
            if (Array.isArray(child.value)) {
                const amount = child.value.find(v => v.name === 'amount');
                if (amount && typeof amount.value === 'number') {
                    items.push(extractConditionFolder(child.value, scopeStack, 'count', ['amount'], amount.value));
                }
            }
        }
        else if ((0, scope_1.tryMoveScope)(child, scopeStack, 'condition')) {
            items.push(extractConditionFolder(child.value, scopeStack));
            scopeStack.pop();
        }
        else {
            items.push({
                scopeName: currentScope.scopeName,
                nodeContent: (0, tostring_1.nodeToString)(child),
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
    if (type === 'count') {
        return { type, amount, items };
    }
    return { type, items };
}
exports.extractConditionFolder = extractConditionFolder;
function applyCondition(condition, trueExprs) {
    if (typeof condition === 'boolean') {
        return condition;
    }
    if (!('items' in condition)) {
        return trueExprs.some(e => (0, lodash_1.isEqual)(condition, e));
    }
    if (condition.type === 'count') {
        return condition.items.filter(item => applyCondition(item, trueExprs)).length >= condition.amount;
    }
    let ifSubConditionIs;
    let resultIs;
    let otherwise;
    switch (condition.type) {
        case 'and':
            ifSubConditionIs = false;
            resultIs = false;
            otherwise = true;
            break;
        case 'or':
            ifSubConditionIs = true;
            resultIs = true;
            otherwise = false;
            break;
        case 'andnot':
            ifSubConditionIs = false;
            resultIs = true;
            otherwise = false;
            break;
        case 'ornot':
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
exports.applyCondition = applyCondition;
function handleIf(ifNode, limit, scopeStack) {
    return {
        type: 'or',
        items: [{
                type: 'and',
                items: [
                    extractConditionFolder(limit.value, scopeStack, 'and'),
                    extractConditionFolder(ifNode.value, scopeStack, 'and', ['limit', 'else_if', 'else']),
                ],
            }],
    };
}
function handleElseIf(elseIfNode, ifItem, scopeStack) {
    if (!Array.isArray(elseIfNode.value)) {
        return;
    }
    const elseiflimit = elseIfNode.value.find(v => v.name === 'limit');
    if (elseiflimit) {
        const lastItemItems = ifItem.items[ifItem.items.length - 1].items;
        const newItem = [
            ...lastItemItems.slice(0, lastItemItems.length - 2),
            Object.assign(Object.assign({}, lastItemItems[lastItemItems.length - 2]), { type: 'andnot' }),
            extractConditionFolder(elseiflimit.value, scopeStack, 'and'),
            extractConditionFolder(elseIfNode.value, scopeStack, 'and', ['limit', 'else_if', 'else']),
        ];
        ifItem.items.push({
            type: 'and',
            items: newItem,
        });
    }
}
function handleElse(elseNode, ifItem, scopeStack) {
    if (elseNode === null || Array.isArray(elseNode.value)) {
        const lastItemItems = ifItem.items[ifItem.items.length - 1].items;
        const newItem = [
            ...lastItemItems.slice(0, lastItemItems.length - 2),
            Object.assign(Object.assign({}, lastItemItems[lastItemItems.length - 2]), { type: 'andnot' })
        ];
        if (elseNode !== null) {
            newItem.push(extractConditionFolder(elseNode.value, scopeStack, 'and', ['limit', 'else_if', 'else']));
        }
        ifItem.items.push({
            type: 'and',
            items: newItem,
        });
    }
}
function simplifyCondition(condition) {
    if (typeof condition === 'boolean' || !('items' in condition)) {
        return condition;
    }
    const simplifiedItems = [];
    let amount = condition.type === 'count' ? condition.amount : 0;
    for (const item of condition.items) {
        const simplified = simplifyCondition(item);
        if (typeof simplified === 'boolean') {
            if (simplified) {
                if (condition.type === 'or') {
                    return true;
                }
                else if (condition.type === 'ornot') {
                    return false;
                }
                else if (condition.type === 'count') {
                    amount--;
                }
            }
            else {
                if (condition.type === 'and') {
                    return false;
                }
                else if (condition.type === 'andnot') {
                    return true;
                }
            }
        }
        else {
            simplifiedItems.push(simplified);
        }
    }
    if (simplifiedItems.length === 0) {
        return condition.type === 'and' || condition.type === 'ornot';
    }
    if (condition.type === 'count') {
        if (amount <= 0) {
            return true;
        }
        else if (amount > simplifiedItems.length) {
            return false;
        }
        else if (amount === simplifiedItems.length) {
            return simplifyCondition({ type: 'and', items: simplifiedItems });
        }
    }
    if (simplifiedItems.length === 1) {
        if (condition.type === 'and' || condition.type === 'or') {
            return simplifyCondition(simplifiedItems[0]);
        }
        if (condition.type === 'andnot') {
            return simplifyCondition({ type: 'ornot', items: simplifiedItems });
        }
        if (condition.type === 'ornot') {
            const child = simplifiedItems[0];
            if (typeof child === 'object' && 'items' in child && (child.type === 'andnot' || child.type === 'ornot')) {
                return simplifyCondition({ type: child.type === 'andnot' ? 'and' : 'or', items: child.items });
            }
        }
    }
    if (condition.type === 'count') {
        return Object.assign(Object.assign({}, condition), { amount, items: simplifiedItems });
    }
    return Object.assign(Object.assign({}, condition), { items: simplifiedItems });
}
exports.simplifyCondition = simplifyCondition;
function extractConditionalExprs(condition, result = []) {
    if (typeof condition === 'boolean') {
        return result;
    }
    if (!('items' in condition)) {
        if (result.every(e => !(0, lodash_1.isEqual)(e, condition))) {
            result.push(condition);
        }
        return result;
    }
    for (const item of condition.items) {
        extractConditionalExprs(item, result);
    }
    return result;
}
exports.extractConditionalExprs = extractConditionalExprs;
function conditionToString(condition) {
    if (typeof condition === 'boolean') {
        return condition.toString();
    }
    if (!('items' in condition)) {
        return (condition.scopeName !== '' ? '[' + condition.scopeName + ']' : '') + condition.nodeContent;
    }
    return condition.type + '(' + condition.items.map(conditionToString).join(', ') + ')' + (condition.type === 'count' ? ' == ' + condition.amount : '');
}
exports.conditionToString = conditionToString;
//# sourceMappingURL=condition.js.map