"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.variableRegexForScope = exports.variableRegex = exports.positionSchema = void 0;
exports.forEachNodeValue = forEachNodeValue;
exports.isSymbolNode = isSymbolNode;
exports.convertNodeToJson = convertNodeToJson;
exports.toNumberLike = toNumberLike;
exports.parseNumberLike = parseNumberLike;
exports.toStringAsSymbolIgnoreCase = toStringAsSymbolIgnoreCase;
exports.positionSchema = {
    x: "numberlike",
    y: "numberlike",
};
//#endregion
exports.variableRegex = /^(?:(?<prefix>\w+):)?(?<scope>(?:\w+\.)*)?(?<var>\w+)(?:@(?<target>(?:\w+\.)*\w+))?(?:\?(?<default>\d+))?$/;
exports.variableRegexForScope = /^(?:(?<prefix>\w+):)(?<scope>(?:\w+\.)*)?(?<var>\w+)(?:@(?<target>(?:\w+\.)*\w+))?$/;
//#region Functions
function forEachNodeValue(node, callback) {
    if (!Array.isArray(node.value)) {
        return;
    }
    node.value.forEach(callback);
}
function isSymbolNode(value) {
    return typeof value === 'object' && value !== null && 'name' in value;
}
function applyConstantsToNode(node, constants) {
    if (isSymbolNode(node.value) && node.value.name.startsWith('@')) {
        return {
            ...node,
            value: constants[node.value.name],
        };
    }
    return node;
}
function convertString(node) {
    if (isSymbolNode(node.value)) {
        const variable = tryParseVariable(node.value.name, false);
        if (variable !== undefined) {
            return variable;
        }
        return node.value.name;
    }
    return typeof node.value === 'string' ? node.value : (typeof node.value === 'number' ? node.value.toString() : undefined);
}
function convertNumber(node) {
    if (isSymbolNode(node.value)) {
        return tryParseVariable(node.value.name, true);
    }
    return typeof node.value === 'number' ? node.value : undefined;
}
function convertNumberLike(node) {
    if (typeof node.value === 'number') {
        return {
            _value: node.value,
            _unit: undefined,
            _token: undefined,
        };
    }
    else if (isSymbolNode(node.value)) {
        return parseNumberLike(node.value.name);
    }
    else {
        return undefined;
    }
}
function convertStringIgnoreCase(node) {
    return isSymbolNode(node.value) ? { _name: node.value.name.toLowerCase(), _stringAsSymbolIgnoreCase: true, _token: undefined } :
        typeof node.value === 'string' ? { _name: node.value.toLowerCase(), _stringAsSymbolIgnoreCase: true, _token: undefined } : undefined;
}
function convertBoolean(node) {
    return isSymbolNode(node.value) ? (node.value.name === 'yes' ? true : (node.value.name === 'no' ? false : undefined)) : undefined;
}
function convertEnum(node) {
    return Array.isArray(node.value) ?
        { _values: node.value.map(v => v.name).filter((v) => v !== null), _token: undefined } :
        { _values: [], _token: undefined };
}
function convertMap(node, innerSchema, constants = {}) {
    const result = { _map: {}, _token: undefined };
    const map = result._map;
    forEachNodeValue(node, child => {
        if (!child.name) {
            return;
        }
        const childName = child.name;
        if (childName.startsWith('@') && child.operator === '=') {
            constants[childName] = child.value;
            return;
        }
        map[childName] = {
            _value: convertNodeToJson(child, innerSchema, constants),
            _key: childName,
        };
    });
    return result;
}
function convertDetailValue(node, innerSchema, constants = {}) {
    return {
        _attachment: node.valueAttachment?.name,
        _attachmentToken: node.valueAttachmentToken ?? undefined,
        _operator: node.operator ?? undefined,
        _operatorToken: node.operatorToken ?? undefined,
        _startToken: node.valueStartToken ?? undefined,
        _endToken: node.valueEndToken ?? undefined,
        _token: node.nameToken ?? undefined,
        _value: convertNodeToJson(node, innerSchema, constants),
    };
}
function convertObject(node, schemaDef, constants = {}) {
    const result = {};
    const schema = schemaDef;
    for (const childSchemaEntry of Object.entries(schema)) {
        if (typeof childSchemaEntry[1] === 'object') {
            const type = childSchemaEntry[1]._type;
            if (type === 'map') {
                result[childSchemaEntry[0]] = { _map: {}, _token: undefined };
            }
            else if (type === 'array') {
                result[childSchemaEntry[0]] = [];
            }
        }
        else if (childSchemaEntry[1] === 'enum') {
            result[childSchemaEntry[0]] = { _values: [], _token: undefined };
        }
    }
    forEachNodeValue(node, (child, index) => {
        if (!child.name) {
            return;
        }
        if (child.name.startsWith('@') && child.operator === '=') {
            constants[child.name] = child.value;
            return;
        }
        const childName = child.name.toLowerCase();
        const childSchemaDef = schema[childName];
        if (!childSchemaDef) {
            return;
        }
        let setChildValue = true;
        if (typeof childSchemaDef === 'object') {
            const type = childSchemaDef._type;
            if (type === 'map') {
                const mapData = convertNodeToJson(child, childSchemaDef, constants)._map;
                Object.assign(result[childName]._map, mapData);
            }
            else if (type === 'array') {
                const innerType = childSchemaDef._innerType;
                const convertedChild = convertNodeToJson(child, innerType, constants);
                if (typeof convertedChild === 'object') {
                    convertedChild._index = index;
                }
                result[childName].push(convertedChild);
            }
            else {
                setChildValue = false;
            }
        }
        else if (childSchemaDef === 'enum') {
            const enums = convertNodeToJson(child, childSchemaDef, constants)._values;
            result[childName]._values.push(...enums);
        }
        else {
            setChildValue = false;
        }
        if (!setChildValue) {
            result[childName] = convertNodeToJson(child, childSchemaDef, constants);
        }
    });
    return result;
}
function tryParseVariable(str, isNumber) {
    const match = exports.variableRegex.exec(str);
    if (!match) {
        return undefined;
    }
    if (isNumber) {
        if (match.groups?.default) {
            return parseFloat(match.groups.default);
        }
        return 0;
    }
    else {
        if (match.groups?.prefix) {
            return str;
        }
        return undefined;
    }
}
function convertNodeToJson(node, schemaDef, constants = {}) {
    const schema = schemaDef;
    let result;
    node = applyConstantsToNode(node, constants);
    if (typeof schema === 'string') {
        switch (schema) {
            case 'string':
                result = convertString(node);
                break;
            case 'number':
                result = convertNumber(node);
                break;
            case 'numberlike':
                result = convertNumberLike(node);
                break;
            case 'stringignorecase':
                result = convertStringIgnoreCase(node);
                break;
            case 'boolean':
                result = convertBoolean(node);
                break;
            case 'enum':
                result = convertEnum(node);
                break;
            case 'raw':
                result = { _raw: node };
                break;
            default:
                throw new Error('Unknown schema ' + schema);
        }
    }
    else if (typeof schema === 'object') {
        const type = schema._type;
        if (type === 'map') {
            result = convertMap(node, schema._innerType, constants);
        }
        else if (type === 'array') {
            throw new Error("Array can't be here.");
        }
        else if (type === 'detailvalue') {
            result = convertDetailValue(node, schema._innerType, constants);
        }
        else {
            result = convertObject(node, schema, constants);
        }
    }
    else {
        throw new Error('Bad schema ' + schema);
    }
    if (typeof result === 'object') {
        result._token = node.nameToken ?? undefined;
    }
    return result;
}
function toNumberLike(value) {
    return {
        _value: value,
        _unit: undefined,
        _token: undefined,
    };
}
function parseNumberLike(value) {
    const regex = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(%%?)$/;
    const result = regex.exec(value);
    if (!result) {
        return undefined;
    }
    return {
        _value: parseFloat(result[1]),
        _unit: result[2],
        _token: undefined,
    };
}
function toStringAsSymbolIgnoreCase(value) {
    return {
        _name: value,
        _stringAsSymbolIgnoreCase: true,
        _token: undefined,
    };
}
//#endregion
//# sourceMappingURL=schema.js.map