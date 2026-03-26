"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guiFileSchema = void 0;
const schema_1 = require("./schema");
const sizeSchema = {
    width: "numberlike",
    height: "numberlike",
    x: "numberlike",
    y: "numberlike",
};
const marginSchema = {
    top: "numberlike",
    left: "numberlike",
    right: "numberlike",
    bottom: "numberlike",
};
const complexSizeSchema = Object.assign(Object.assign({}, sizeSchema), { min: sizeSchema });
const backgroundSchema = {
    name: "string",
    spritetype: "string",
    quadtexturesprite: "string",
    position: schema_1.positionSchema,
};
const gridBoxTypeSchema = {
    name: "string",
    orientation: "stringignorecase",
    position: schema_1.positionSchema,
    size: sizeSchema,
    slotsize: sizeSchema,
    background: backgroundSchema,
    format: "stringignorecase",
};
const iconTypeSchema = {
    name: "string",
    orientation: "stringignorecase",
    position: schema_1.positionSchema,
    centerposition: 'boolean',
    spritetype: "string",
    quadtexturesprite: "string",
    frame: "number",
    scale: "number",
};
const instantTextBoxTypeSchema = {
    name: "string",
    orientation: "stringignorecase",
    position: schema_1.positionSchema,
    bordersize: schema_1.positionSchema,
    maxwidth: "numberlike",
    maxheight: "numberlike",
    format: "stringignorecase",
    font: "string",
    text: "string",
    vertical_alignment: "string",
};
const buttonTypeSchema = {
    name: "string",
    spritetype: "string",
    quadtexturesprite: "string",
    position: schema_1.positionSchema,
    orientation: "stringignorecase",
    frame: "number",
    text: "string",
    buttontext: "string",
    buttonfont: "string",
    scale: "number",
    centerposition: 'boolean',
};
const containerWindowTypeSchema = {
    name: "string",
    orientation: "stringignorecase",
    origo: "stringignorecase",
    position: schema_1.positionSchema,
    size: complexSizeSchema,
    margin: marginSchema,
    background: backgroundSchema,
    containerwindowtype: {
        _innerType: undefined,
        _type: "array",
    },
    windowtype: {
        _innerType: undefined,
        _type: "array",
    },
    gridboxtype: {
        _innerType: gridBoxTypeSchema,
        _type: "array",
    },
    icontype: {
        _innerType: iconTypeSchema,
        _type: "array",
    },
    instanttextboxtype: {
        _innerType: instantTextBoxTypeSchema,
        _type: "array",
    },
    textboxtype: {
        _innerType: instantTextBoxTypeSchema,
        _type: "array",
    },
    buttontype: {
        _innerType: buttonTypeSchema,
        _type: "array",
    },
    checkboxtype: {
        _innerType: buttonTypeSchema,
        _type: "array",
    },
    guibuttontype: {
        _innerType: buttonTypeSchema,
        _type: "array",
    },
};
containerWindowTypeSchema.containerwindowtype._innerType = containerWindowTypeSchema;
containerWindowTypeSchema.windowtype._innerType = containerWindowTypeSchema;
const guiTypesSchema = {
    containerwindowtype: {
        _innerType: containerWindowTypeSchema,
        _type: "array",
    },
    windowtype: {
        _innerType: containerWindowTypeSchema,
        _type: "array",
    },
};
exports.guiFileSchema = {
    guitypes: {
        _innerType: guiTypesSchema,
        _type: "array",
    },
};
//# sourceMappingURL=gui.js.map