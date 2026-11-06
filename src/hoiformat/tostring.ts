import { Node, NodeValue } from './hoiparser';

// Escaped exactly as hoiparser.ts's stringEscapeRegex decodes; JSON.stringify's `\n` would read back as those two characters.
const escapes = /[\\"]/g;

export function nodeToString(node: Node): string {
    return [node.name, node.operator, node.valueAttachment?.name, nodeValueToString(node.value)].filter(v => !!v).join(' ');
}

function nodeValueToString(nodeValue: NodeValue): string | null {
    if (Array.isArray(nodeValue)) {
        return [ '{', ...nodeValue.map(v => nodeToString(v)), '}' ].join(' ');
    }

    if (nodeValue === null) {
        return null;
    }

    if (typeof nodeValue === 'object') {
        return nodeValue.name;
    }

    if (typeof nodeValue === 'string') {
        return '"' + nodeValue.replace(escapes, '\\$&') + '"';
    }

    return nodeValue.toString();
}
