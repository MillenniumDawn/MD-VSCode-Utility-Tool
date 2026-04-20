"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeToString = nodeToString;
function nodeToString(node) {
    return [node.name, node.operator, node.valueAttachment?.name, nodeValueToString(node.value)].filter(v => !!v).join(' ');
}
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