"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSpriteTypes = void 0;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const file = (0, schema_1.convertNodeToJson)(node, spriteFileSchema);
    const result = [];
    for (const spritetypes of file.spritetypes) {
        for (const sprite of spritetypes.spritetype.concat(spritetypes.frameanimatedspritetype).concat(spritetypes.textspritetype)) {
            const name = (_a = sprite.name) === null || _a === void 0 ? void 0 : _a._value;
            const texturefile = sprite.texturefile;
            if (name && texturefile) {
                result.push({
                    name,
                    texturefile,
                    noofframes: (_b = sprite.noofframes) !== null && _b !== void 0 ? _b : 1,
                    token: sprite.name._startToken,
                });
            }
        }
        for (const sprite of spritetypes.corneredtilespritetype) {
            const name = (_c = sprite.name) === null || _c === void 0 ? void 0 : _c._value;
            const texturefile = sprite.texturefile;
            if (name && texturefile) {
                result.push({
                    name,
                    texturefile,
                    noofframes: (_d = sprite.noofframes) !== null && _d !== void 0 ? _d : 1,
                    size: {
                        x: (_f = (_e = sprite.size) === null || _e === void 0 ? void 0 : _e.x) !== null && _f !== void 0 ? _f : 100,
                        y: (_h = (_g = sprite.size) === null || _g === void 0 ? void 0 : _g.y) !== null && _h !== void 0 ? _h : 100,
                    },
                    bordersize: {
                        x: (_k = (_j = sprite.bordersize) === null || _j === void 0 ? void 0 : _j.x) !== null && _k !== void 0 ? _k : 0,
                        y: (_m = (_l = sprite.bordersize) === null || _l === void 0 ? void 0 : _l.y) !== null && _m !== void 0 ? _m : 0,
                    },
                    tilingCenter: (_o = sprite.tilingCenter) !== null && _o !== void 0 ? _o : false,
                    token: sprite.name._startToken,
                });
            }
        }
    }
    return result;
}
exports.getSpriteTypes = getSpriteTypes;
//# sourceMappingURL=spritetype.js.map