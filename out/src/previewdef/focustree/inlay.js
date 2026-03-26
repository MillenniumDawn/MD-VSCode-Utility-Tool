"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInlayWindowRef = exports.addInlayGfxWarnings = exports.resolveInlayGfxFiles = exports.resolveInlaysForTree = exports.loadFocusInlayWindows = void 0;
const tslib_1 = require("tslib");
const condition_1 = require("../../hoiformat/condition");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const scope_1 = require("../../hoiformat/scope");
const schema_1 = require("../../hoiformat/schema");
const i18n_1 = require("../../util/i18n");
const fileloader_1 = require("../../util/fileloader");
const vsccommon_1 = require("../../util/vsccommon");
const spritetype_1 = require("../../hoiformat/spritetype");
const focusInlayWindowsFolder = "common/focus_inlay_windows";
function loadFocusInlayWindows() {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const files = yield (0, fileloader_1.listFilesFromModOrHOI4)(focusInlayWindowsFolder);
        const inlays = [];
        const warnings = [];
        for (const file of files.filter(f => f.toLowerCase().endsWith(".txt"))) {
            const relativePath = `${focusInlayWindowsFolder}/${file}`.replace(/\\+/g, "/");
            try {
                const [buffer, uri] = yield (0, fileloader_1.readFileFromModOrHOI4)(relativePath);
                const node = (0, hoiparser_1.parseHoi4File)(buffer.toString().replace(/^\uFEFF/, ""), (0, i18n_1.localize)("infile", "In file {0}:\n", uri.toString()));
                const parsed = parseInlayNode(node, relativePath);
                inlays.push(...parsed.inlays);
                warnings.push(...parsed.warnings);
            }
            catch (e) {
                warnings.push({
                    text: (0, i18n_1.localize)("TODO", "Failed to parse inlay window file {0}: {1}", relativePath, e instanceof Error ? e.message : String(e)),
                    source: relativePath,
                });
            }
        }
        return { inlays, warnings };
    });
}
exports.loadFocusInlayWindows = loadFocusInlayWindows;
function parseInlayNode(node, file) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const inlays = [];
    const warnings = [];
    const duplicateIds = {};
    if (!Array.isArray(node.value)) {
        return { inlays, warnings };
    }
    for (const child of node.value) {
        if (!child.name || !Array.isArray(child.value)) {
            continue;
        }
        const inlay = parseSingleInlayNode(child, file);
        if (duplicateIds[inlay.id]) {
            const other = duplicateIds[inlay.id];
            warnings.push({
                text: (0, i18n_1.localize)("TODO", "There're more than one inlay windows with ID {0} in files: {1}, {2}.", inlay.id, other.file, inlay.file),
                source: inlay.id,
                navigations: [
                    { file: other.file, start: (_b = (_a = other.token) === null || _a === void 0 ? void 0 : _a.start) !== null && _b !== void 0 ? _b : 0, end: (_d = (_c = other.token) === null || _c === void 0 ? void 0 : _c.end) !== null && _d !== void 0 ? _d : 0 },
                    { file: inlay.file, start: (_f = (_e = inlay.token) === null || _e === void 0 ? void 0 : _e.start) !== null && _f !== void 0 ? _f : 0, end: (_h = (_g = inlay.token) === null || _g === void 0 ? void 0 : _g.end) !== null && _h !== void 0 ? _h : 0 },
                ],
            });
        }
        else {
            duplicateIds[inlay.id] = inlay;
        }
        inlays.push(inlay);
    }
    return { inlays, warnings };
}
function parseSingleInlayNode(node, file) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const id = (_a = node.name) !== null && _a !== void 0 ? _a : (0, i18n_1.localize)("TODO", "<anonymous inlay>");
    const children = Array.isArray(node.value) ? node.value : [];
    const conditionExprs = [];
    const scriptedImages = [];
    const scriptedButtons = [];
    let windowName;
    let internal = false;
    let visible = true;
    for (const child of children) {
        const childName = (_b = child.name) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        if (!childName) {
            continue;
        }
        if (childName === "window_name") {
            windowName = (_c = (0, schema_1.convertNodeToJson)(child, "string")) !== null && _c !== void 0 ? _c : undefined;
        }
        else if (childName === "internal") {
            internal = (_d = (0, schema_1.convertNodeToJson)(child, "boolean")) !== null && _d !== void 0 ? _d : false;
        }
        else if (childName === "visible") {
            visible = (0, condition_1.extractConditionValue)(child.value, scope_1.countryScope, conditionExprs).condition;
        }
        else if (childName === "scripted_images" && Array.isArray(child.value)) {
            for (const slotNode of child.value) {
                if (!slotNode.name || !Array.isArray(slotNode.value)) {
                    continue;
                }
                const gfxOptions = slotNode.value
                    .filter(optionNode => !!optionNode.name)
                    .map(optionNode => {
                    var _a, _b;
                    return ({
                        gfxName: (_a = optionNode.name) !== null && _a !== void 0 ? _a : "",
                        condition: isAlwaysYes(optionNode) ? true : (0, condition_1.extractConditionValue)(optionNode.value, scope_1.countryScope, conditionExprs).condition,
                        file,
                        token: (_b = optionNode.nameToken) !== null && _b !== void 0 ? _b : undefined,
                    });
                });
                scriptedImages.push({
                    id: slotNode.name,
                    file,
                    token: (_e = slotNode.nameToken) !== null && _e !== void 0 ? _e : undefined,
                    gfxOptions,
                });
            }
        }
        else if (childName === "scripted_buttons" && Array.isArray(child.value)) {
            for (const buttonNode of child.value) {
                if (!buttonNode.name || !Array.isArray(buttonNode.value)) {
                    continue;
                }
                let available = undefined;
                for (const buttonChild of buttonNode.value) {
                    if (((_f = buttonChild.name) === null || _f === void 0 ? void 0 : _f.toLowerCase()) === "available") {
                        available = (0, condition_1.extractConditionValue)(buttonChild.value, scope_1.countryScope, conditionExprs).condition;
                    }
                }
                scriptedButtons.push({
                    id: buttonNode.name,
                    file,
                    token: (_g = buttonNode.nameToken) !== null && _g !== void 0 ? _g : undefined,
                    available,
                });
            }
        }
    }
    return {
        id,
        file,
        token: (_h = node.nameToken) !== null && _h !== void 0 ? _h : undefined,
        windowName,
        internal,
        visible,
        scriptedImages,
        scriptedButtons,
        conditionExprs,
        position: { x: 0, y: 0 },
    };
}
function isAlwaysYes(node) {
    if (typeof node.value === "object" && node.value !== null && "name" in node.value) {
        return node.value.name.toLowerCase() === "yes";
    }
    return false;
}
function resolveInlaysForTree(refs, allInlays, sharedWarnings) {
    const warnings = [...sharedWarnings];
    const conditionExprs = [];
    const inlayWindows = [];
    for (const ref of refs) {
        const matched = allInlays.find(inlay => inlay.id === ref.id);
        if (!matched) {
            warnings.push({
                text: (0, i18n_1.localize)("TODO", "Focus tree references missing inlay window: {0}.", ref.id),
                source: ref.id,
                navigations: ref.token ? [{ file: ref.file, start: ref.token.start, end: ref.token.end }] : undefined,
            });
            continue;
        }
        const resolved = Object.assign(Object.assign({}, matched), { position: ref.position });
        (0, condition_1.extractConditionalExprs)(resolved.visible, conditionExprs);
        resolved.scriptedImages.forEach(slot => slot.gfxOptions.forEach(option => (0, condition_1.extractConditionalExprs)(option.condition, conditionExprs)));
        if (resolved.scriptedButtons) {
            resolved.scriptedButtons.forEach(button => button.available && (0, condition_1.extractConditionalExprs)(button.available, conditionExprs));
        }
        inlayWindows.push(resolved);
    }
    return { inlayWindows, inlayConditionExprs: conditionExprs, warnings };
}
exports.resolveInlaysForTree = resolveInlaysForTree;
function resolveInlayGfxFiles(inlays) {
    var _a;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const roots = ((_a = (0, vsccommon_1.getConfiguration)().inlayWindowGfxRoots) !== null && _a !== void 0 ? _a : []).filter((root) => !!root && root.trim() !== "");
        const candidateFiles = [];
        for (const root of roots) {
            try {
                const files = yield (0, fileloader_1.listFilesFromModOrHOI4)(root.replace(/\\+/g, "/"), { recursively: true });
                for (const file of files) {
                    if (file.toLowerCase().endsWith(".gfx")) {
                        candidateFiles.push(`${root.replace(/\\+/g, "/")}/${file}`.replace(/\/+/g, "/"));
                    }
                }
            }
            catch (e) {
            }
        }
        const gfxFileByName = {};
        const resolvedFiles = new Set();
        for (const candidateFile of candidateFiles) {
            try {
                const [buffer, uri] = yield (0, fileloader_1.readFileFromModOrHOI4)(candidateFile);
                const spriteTypes = (0, spritetype_1.getSpriteTypes)((0, hoiparser_1.parseHoi4File)(buffer.toString().replace(/^\uFEFF/, ""), (0, i18n_1.localize)("infile", "In file {0}:\n", uri.toString())));
                for (const spriteType of spriteTypes) {
                    if (!(spriteType.name in gfxFileByName)) {
                        gfxFileByName[spriteType.name] = candidateFile;
                    }
                }
            }
            catch (e) {
            }
        }
        for (const inlay of inlays) {
            for (const slot of inlay.scriptedImages) {
                for (const option of slot.gfxOptions) {
                    const resolved = gfxFileByName[option.gfxName];
                    option.gfxFile = resolved;
                    if (resolved) {
                        resolvedFiles.add(resolved);
                    }
                }
            }
        }
        return {
            resolvedFiles: Array.from(resolvedFiles),
            gfxFileByName,
        };
    });
}
exports.resolveInlayGfxFiles = resolveInlayGfxFiles;
function addInlayGfxWarnings(inlays, warnings) {
    for (const inlay of inlays) {
        for (const slot of inlay.scriptedImages) {
            for (const option of slot.gfxOptions) {
                if (!option.gfxFile) {
                    warnings.push({
                        text: (0, i18n_1.localize)("TODO", "Can't resolve inlay GFX {0} for slot {1} in inlay {2}.", option.gfxName, slot.id, inlay.id),
                        source: inlay.id,
                        navigations: option.token ? [{ file: option.file, start: option.token.start, end: option.token.end }] : undefined,
                    });
                }
            }
        }
    }
}
exports.addInlayGfxWarnings = addInlayGfxWarnings;
function parseInlayWindowRef(node, file) {
    var _a, _b, _c, _d, _e;
    const idNode = Array.isArray(node.value) ? node.value.find(child => { var _a; return ((_a = child.name) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "id"; }) : undefined;
    const positionNode = Array.isArray(node.value) ? node.value.find(child => { var _a; return ((_a = child.name) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "position"; }) : undefined;
    const id = idNode ? (0, schema_1.convertNodeToJson)(idNode, "string") : undefined;
    const position = positionNode ? (0, schema_1.convertNodeToJson)(positionNode, schema_1.positionSchema) : undefined;
    if (!id) {
        return undefined;
    }
    return {
        id,
        file,
        token: (_a = node.nameToken) !== null && _a !== void 0 ? _a : undefined,
        position: {
            x: (_c = (_b = position === null || position === void 0 ? void 0 : position.x) === null || _b === void 0 ? void 0 : _b._value) !== null && _c !== void 0 ? _c : 0,
            y: (_e = (_d = position === null || position === void 0 ? void 0 : position.y) === null || _d === void 0 ? void 0 : _d._value) !== null && _e !== void 0 ? _e : 0,
        },
    };
}
exports.parseInlayWindowRef = parseInlayWindowRef;
//# sourceMappingURL=inlay.js.map