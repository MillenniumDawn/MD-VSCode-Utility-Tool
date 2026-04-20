"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadFocusInlayWindows = loadFocusInlayWindows;
exports.resolveInlaysForTree = resolveInlaysForTree;
exports.resolveInlayGuiWindows = resolveInlayGuiWindows;
exports.resolveInlayGfxFiles = resolveInlayGfxFiles;
exports.addInlayGfxWarnings = addInlayGfxWarnings;
exports.parseInlayWindowRef = parseInlayWindowRef;
const gui_1 = require("../../hoiformat/gui");
const condition_1 = require("../../hoiformat/condition");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const scope_1 = require("../../hoiformat/scope");
const schema_1 = require("../../hoiformat/schema");
const i18n_1 = require("../../util/i18n");
const fileloader_1 = require("../../util/fileloader");
const vsccommon_1 = require("../../util/vsccommon");
const spritetype_1 = require("../../hoiformat/spritetype");
const focusInlayWindowsFolder = "common/focus_inlay_windows";
const scriptedGuiFolder = "interface/scripted_gui";
async function loadFocusInlayWindows() {
    const files = await (0, fileloader_1.listFilesFromModOrHOI4)(focusInlayWindowsFolder);
    const inlays = [];
    const warnings = [];
    for (const file of files.filter(f => f.toLowerCase().endsWith(".txt"))) {
        const relativePath = `${focusInlayWindowsFolder}/${file}`.replace(/\\+/g, "/");
        try {
            const [buffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(relativePath);
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
}
function parseInlayNode(node, file) {
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
                    { file: other.file, start: other.token?.start ?? 0, end: other.token?.end ?? 0 },
                    { file: inlay.file, start: inlay.token?.start ?? 0, end: inlay.token?.end ?? 0 },
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
    const id = node.name ?? (0, i18n_1.localize)("TODO", "<anonymous inlay>");
    const children = Array.isArray(node.value) ? node.value : [];
    const conditionExprs = [];
    const scriptedImages = [];
    const scriptedButtons = [];
    let windowName;
    let internal = false;
    let visible = true;
    for (const child of children) {
        const childName = child.name?.toLowerCase();
        if (!childName) {
            continue;
        }
        if (childName === "window_name") {
            windowName = (0, schema_1.convertNodeToJson)(child, "string") ?? undefined;
        }
        else if (childName === "internal") {
            internal = (0, schema_1.convertNodeToJson)(child, "boolean") ?? false;
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
                    .map(optionNode => ({
                    gfxName: optionNode.name ?? "",
                    condition: isAlwaysYes(optionNode) ? true : (0, condition_1.extractConditionValue)(optionNode.value, scope_1.countryScope, conditionExprs).condition,
                    file,
                    token: optionNode.nameToken ?? undefined,
                }));
                scriptedImages.push({
                    id: slotNode.name,
                    file,
                    token: slotNode.nameToken ?? undefined,
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
                    if (buttonChild.name?.toLowerCase() === "available") {
                        available = (0, condition_1.extractConditionValue)(buttonChild.value, scope_1.countryScope, conditionExprs).condition;
                    }
                }
                scriptedButtons.push({
                    id: buttonNode.name,
                    file,
                    token: buttonNode.nameToken ?? undefined,
                    available,
                });
            }
        }
    }
    return {
        id,
        file,
        token: node.nameToken ?? undefined,
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
function resolveInlaysForTree(refs, allInlays) {
    const warnings = [];
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
        const resolved = {
            ...matched,
            position: ref.position,
        };
        (0, condition_1.extractConditionalExprs)(resolved.visible, conditionExprs);
        resolved.scriptedImages.forEach(slot => slot.gfxOptions.forEach(option => (0, condition_1.extractConditionalExprs)(option.condition, conditionExprs)));
        if (resolved.scriptedButtons) {
            resolved.scriptedButtons.forEach(button => button.available && (0, condition_1.extractConditionalExprs)(button.available, conditionExprs));
        }
        inlayWindows.push(resolved);
    }
    return { inlayWindows, inlayConditionExprs: conditionExprs, warnings };
}
async function resolveInlayGuiWindows(inlays) {
    const warnings = [];
    const guiFiles = await listGuiFiles();
    const gfxFiles = await listGuiGfxFiles();
    const parsedGuiFiles = [];
    for (const guiFile of guiFiles) {
        try {
            const [buffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(guiFile);
            const guiNode = (0, hoiparser_1.parseHoi4File)(buffer.toString().replace(/^\uFEFF/, ""), (0, i18n_1.localize)("infile", "In file {0}:\n", uri.toString()));
            const guiFileData = (0, schema_1.convertNodeToJson)(guiNode, gui_1.guiFileSchema);
            const windows = collectContainerWindows(guiFileData);
            parsedGuiFiles.push({ file: guiFile, windows });
        }
        catch (e) {
        }
    }
    for (const inlay of inlays) {
        if (!inlay.windowName) {
            continue;
        }
        const matched = parsedGuiFiles.find(gui => gui.windows[inlay.windowName] !== undefined);
        if (!matched) {
            warnings.push({
                text: (0, i18n_1.localize)("TODO", "Can't resolve scripted GUI window {0} for inlay {1}.", inlay.windowName, inlay.id),
                source: inlay.id,
                navigations: inlay.token ? [{ file: inlay.file, start: inlay.token.start, end: inlay.token.end }] : undefined,
            });
            continue;
        }
        inlay.guiFile = matched.file;
        inlay.guiWindow = matched.windows[inlay.windowName];
    }
    return { guiFiles, gfxFiles, warnings };
}
async function listGuiFiles() {
    try {
        const files = await (0, fileloader_1.listFilesFromModOrHOI4)(scriptedGuiFolder, { recursively: true });
        return files
            .filter(file => file.toLowerCase().endsWith(".gui"))
            .map(file => `${scriptedGuiFolder}/${file}`.replace(/\/+/g, "/"));
    }
    catch (e) {
        return [];
    }
}
async function listGuiGfxFiles() {
    try {
        const files = await (0, fileloader_1.listFilesFromModOrHOI4)(scriptedGuiFolder, { recursively: true });
        return files
            .filter(file => file.toLowerCase().endsWith(".gfx"))
            .map(file => `${scriptedGuiFolder}/${file}`.replace(/\/+/g, "/"));
    }
    catch (e) {
        return [];
    }
}
function collectContainerWindows(guiFile) {
    const result = {};
    for (const guiTypes of guiFile.guitypes) {
        for (const containerWindow of [...guiTypes.containerwindowtype, ...guiTypes.windowtype]) {
            collectContainerWindowRecursive(containerWindow, result);
        }
    }
    return result;
}
function collectContainerWindowRecursive(containerWindow, result) {
    if (containerWindow.name && !(containerWindow.name in result)) {
        result[containerWindow.name] = containerWindow;
    }
    for (const child of [...containerWindow.containerwindowtype, ...containerWindow.windowtype]) {
        collectContainerWindowRecursive(child, result);
    }
}
async function resolveInlayGfxFiles(inlays) {
    const roots = ((0, vsccommon_1.getConfiguration)().inlayWindowGfxRoots ?? []).filter((root) => !!root && root.trim() !== "");
    const candidateFiles = [];
    for (const root of roots) {
        try {
            const files = await (0, fileloader_1.listFilesFromModOrHOI4)(root.replace(/\\+/g, "/"), { recursively: true });
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
            const [buffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(candidateFile);
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
    };
}
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
function parseInlayWindowRef(node, file) {
    const idNode = Array.isArray(node.value) ? node.value.find(child => child.name?.toLowerCase() === "id") : undefined;
    const positionNode = Array.isArray(node.value) ? node.value.find(child => child.name?.toLowerCase() === "position") : undefined;
    const id = idNode ? (0, schema_1.convertNodeToJson)(idNode, "string") : undefined;
    const position = positionNode ? (0, schema_1.convertNodeToJson)(positionNode, schema_1.positionSchema) : undefined;
    if (!id) {
        return undefined;
    }
    return {
        id,
        file,
        token: node.nameToken ?? undefined,
        position: {
            x: position?.x?._value ?? 0,
            y: position?.y?._value ?? 0,
        },
    };
}
//# sourceMappingURL=inlay.js.map