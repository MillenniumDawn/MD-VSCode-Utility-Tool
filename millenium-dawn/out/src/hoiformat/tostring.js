"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeToString = void 0;
function nodeToString(node) {
    var _a;
    return [node.name, node.operator, (_a = node.valueAttachment) === null || _a === void 0 ? void 0 : _a.name, nodeValueToString(node.value)].filter(v => !!v).join(' ');
}
exports.nodeToString = nodeToString;
function nodeValueToString(nodeValue) {
    if (Array.isArray(nodeValue)) {
        return ['{', ...nodeValue.map(v => nodeToString(v)), '}'].join(' ');
    }
    if (nodeValue === null) {
        return null;
    }
    if (typeof nodeValue === 'object') {
        return nodeValue.name;
    }
    if (typeof nodeValue === 'string') {
        return '"' + nodeValue + '"';
    }
    return nodeValue.toString();
}
//# sourceMappingURL=tostring.js.map