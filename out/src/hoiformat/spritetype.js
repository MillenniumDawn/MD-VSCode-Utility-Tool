"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSpriteTypes = getSpriteTypes;
const schema_1 = require("./schema");
const corneredTileSpriteTypeSchema = {
    name: {
        _innerType: "string",
        _type: "detailvalue",
    },
    texturefile: "string",
    noofframes: "number",
    size: {
        x: "number",
        y: "number",
    },
    bordersize: {
        x: "number",
        y: "number",
    },
    tilingCenter: "boolean",
};
const spriteTypeSchema = {
    name: {
        _innerType: "string",
        _type: "detailvalue",
    },
    texturefile: "string",
    noofframes: "number",
};
const spriteTypesSchema = {
    spritetype: {
        _innerType: spriteTypeSchema,
        _type: "array",
    },
    corneredtilespritetype: {
        _innerType: corneredTileSpriteTypeSchema,
        _type: "array",
    },
    frameanimatedspritetype: {
        _innerType: spriteTypeSchema,
        _type: "array",
    },
    textspritetype: {
        _innerType: spriteTypeSchema,
        _type: "array",
    },
};
const spriteFileSchema = {
    spritetypes: {
        _innerType: spriteTypesSchema,
        _type: "array",
    },
};
function getSpriteTypes(node) {
    const file = (0, schema_1.convertNodeToJson)(node, spriteFileSchema);
    const result = [];
    for (const spritetypes of file.spritetypes) {
        for (const sprite of spritetypes.spritetype.concat(spritetypes.frameanimatedspritetype).concat(spritetypes.textspritetype)) {
            const name = sprite.name?._value;
            const texturefile = sprite.texturefile;
            if (name && texturefile) {
                result.push({
                    name,
                    texturefile,
                    noofframes: sprite.noofframes ?? 1,
                    token: sprite.name._startToken,
                });
            }
        }
        for (const sprite of spritetypes.corneredtilespritetype) {
            const name = sprite.name?._value;
            const texturefile = sprite.texturefile;
            if (name && texturefile) {
                result.push({
                    name,
                    texturefile,
                    noofframes: sprite.noofframes ?? 1,
                    size: {
                        x: sprite.size?.x ?? 100,
                        y: sprite.size?.y ?? 100,
                    },
                    bordersize: {
                        x: sprite.bordersize?.x ?? 0,
                        y: sprite.bordersize?.y ?? 0,
                    },
                    tilingCenter: sprite.tilingCenter ?? false,
                    token: sprite.name._startToken,
                });
            }
        }
    }
    return result;
}
//# sourceMappingURL=spritetype.js.map