import { GuiFile, guiFileSchema, ContainerWindowType } from "../../hoiformat/gui";
import { extractConditionValue, extractConditionalExprs, ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";
import { Node, parseHoi4File } from "../../hoiformat/hoiparser";
import { countryScope } from "../../hoiformat/scope";
import { convertNodeToJson, positionSchema, Position, HOIPartial } from "../../hoiformat/schema";
import { localize } from "../../util/i18n";
import type { FocusInlayGfxOption, FocusInlayImageSlot, FocusTreeInlay, FocusTreeInlayButtonMeta, FocusTreeInlayRef, FocusWarning } from "./schema";
import { listFilesFromModOrHOI4, readFileFromModOrHOI4 } from "../../util/fileloader";
import { getConfiguration } from "../../util/vsccommon";
import { getSpriteTypes } from "../../hoiformat/spritetype";

interface ParsedInlayFile {
    inlays: FocusTreeInlay[];
    warnings: FocusWarning[];
}

const focusInlayWindowsFolder = "common/focus_inlay_windows";
const scriptedGuiFolder = "interface/scripted_gui";

export async function loadFocusInlayWindows(): Promise<ParsedInlayFile> {
    const files = await listFilesFromModOrHOI4(focusInlayWindowsFolder);
    const inlays: FocusTreeInlay[] = [];
    const warnings: FocusWarning[] = [];

    for (const file of files.filter(f => f.toLowerCase().endsWith(".txt"))) {
        const relativePath = `${focusInlayWindowsFolder}/${file}`.replace(/\\+/g, "/");
        try {
            const [buffer, uri] = await readFileFromModOrHOI4(relativePath);
            const node = parseHoi4File(buffer.toString().replace(/^\uFEFF/, ""), localize("infile", "In file {0}:\n", uri.toString()));
            const parsed = parseInlayNode(node, relativePath);
            inlays.push(...parsed.inlays);
            warnings.push(...parsed.warnings);
        } catch (e) {
            warnings.push({
                text: localize("TODO", "Failed to parse inlay window file {0}: {1}", relativePath, e instanceof Error ? e.message : String(e)),
                source: relativePath,
            });
        }
    }

    return { inlays, warnings };
}

function parseInlayNode(node: Node, file: string): ParsedInlayFile {
    const inlays: FocusTreeInlay[] = [];
    const warnings: FocusWarning[] = [];
    const duplicateIds: Record<string, FocusTreeInlay | undefined> = {};

    if (!Array.isArray(node.value)) {
        return { inlays, warnings };
    }

    for (const child of node.value) {
        if (!child.name || !Array.isArray(child.value)) {
            continue;
        }

        const inlay = parseSingleInlayNode(child, file);
        if (duplicateIds[inlay.id]) {
            const other = duplicateIds[inlay.id]!;
            warnings.push({
                text: localize("TODO", "There're more than one inlay windows with ID {0} in files: {1}, {2}.", inlay.id, other.file, inlay.file),
                source: inlay.id,
                navigations: [
                    { file: other.file, start: other.token?.start ?? 0, end: other.token?.end ?? 0 },
                    { file: inlay.file, start: inlay.token?.start ?? 0, end: inlay.token?.end ?? 0 },
                ],
            });
        } else {
            duplicateIds[inlay.id] = inlay;
        }

        inlays.push(inlay);
    }

    return { inlays, warnings };
}

function parseSingleInlayNode(node: Node, file: string): FocusTreeInlay {
    const id = node.name ?? localize("TODO", "<anonymous inlay>");
    const children = Array.isArray(node.value) ? node.value : [];
    const conditionExprs: ConditionItem[] = [];
    const scriptedImages: FocusInlayImageSlot[] = [];
    const scriptedButtons: FocusTreeInlayButtonMeta[] = [];
    let windowName: string | undefined;
    let internal = false;
    let visible: ConditionComplexExpr = true;

    for (const child of children) {
        const childName = child.name?.toLowerCase();
        if (!childName) {
            continue;
        }

        if (childName === "window_name") {
            windowName = convertNodeToJson<string>(child, "string") ?? undefined;
        } else if (childName === "internal") {
            internal = convertNodeToJson<boolean>(child, "boolean") ?? false;
        } else if (childName === "visible") {
            visible = extractConditionValue(child.value, countryScope, conditionExprs).condition;
        } else if (childName === "scripted_images" && Array.isArray(child.value)) {
            for (const slotNode of child.value) {
                if (!slotNode.name || !Array.isArray(slotNode.value)) {
                    continue;
                }
                const gfxOptions: FocusInlayGfxOption[] = slotNode.value
                    .filter(optionNode => !!optionNode.name)
                    .map(optionNode => ({
                        gfxName: optionNode.name ?? "",
                        condition: isAlwaysYes(optionNode) ? true : extractConditionValue(optionNode.value, countryScope, conditionExprs).condition,
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
        } else if (childName === "scripted_buttons" && Array.isArray(child.value)) {
            for (const buttonNode of child.value) {
                if (!buttonNode.name || !Array.isArray(buttonNode.value)) {
                    continue;
                }
                let available: ConditionComplexExpr | undefined = undefined;
                for (const buttonChild of buttonNode.value) {
                    if (buttonChild.name?.toLowerCase() === "available") {
                        available = extractConditionValue(buttonChild.value, countryScope, conditionExprs).condition;
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

function isAlwaysYes(node: Node): boolean {
    if (typeof node.value === "object" && node.value !== null && "name" in node.value) {
        return node.value.name.toLowerCase() === "yes";
    }
    return false;
}

export function resolveInlaysForTree(
    refs: FocusTreeInlayRef[],
    allInlays: FocusTreeInlay[],
): { inlayWindows: FocusTreeInlay[], inlayConditionExprs: ConditionItem[], warnings: FocusWarning[] } {
    const warnings: FocusWarning[] = [];
    const conditionExprs: ConditionItem[] = [];
    const inlayWindows: FocusTreeInlay[] = [];

    for (const ref of refs) {
        const matched = allInlays.find(inlay => inlay.id === ref.id);
        if (!matched) {
            warnings.push({
                text: localize("TODO", "Focus tree references missing inlay window: {0}.", ref.id),
                source: ref.id,
                navigations: ref.token ? [{ file: ref.file, start: ref.token.start, end: ref.token.end }] : undefined,
            });
            continue;
        }

        const resolved: FocusTreeInlay = {
            ...matched,
            position: ref.position,
        };
        extractConditionalExprs(resolved.visible, conditionExprs);
        resolved.scriptedImages.forEach(slot => slot.gfxOptions.forEach(option => extractConditionalExprs(option.condition, conditionExprs)));
        if (resolved.scriptedButtons) {
            resolved.scriptedButtons.forEach(button => button.available && extractConditionalExprs(button.available, conditionExprs));
        }
        inlayWindows.push(resolved);
    }

    return { inlayWindows, inlayConditionExprs: conditionExprs, warnings };
}

interface InlayGfxResolution {
    resolvedFiles: string[];
}

export async function resolveInlayGuiWindows(inlays: FocusTreeInlay[]): Promise<{ guiFiles: string[], gfxFiles: string[], warnings: FocusWarning[] }> {
    const warnings: FocusWarning[] = [];
    const guiFiles = await listGuiFiles();
    const gfxFiles = await listGuiGfxFiles();
    const parsedGuiFiles: { file: string; windows: Record<string, HOIPartial<ContainerWindowType>> }[] = [];

    for (const guiFile of guiFiles) {
        try {
            const [buffer, uri] = await readFileFromModOrHOI4(guiFile);
            const guiNode = parseHoi4File(buffer.toString().replace(/^\uFEFF/, ""), localize("infile", "In file {0}:\n", uri.toString()));
            const guiFileData = convertNodeToJson<GuiFile>(guiNode, guiFileSchema);
            const windows = collectContainerWindows(guiFileData);
            parsedGuiFiles.push({ file: guiFile, windows });
        } catch (e) {
        }
    }

    for (const inlay of inlays) {
        if (!inlay.windowName) {
            continue;
        }

        const matched = parsedGuiFiles.find(gui => gui.windows[inlay.windowName!] !== undefined);
        if (!matched) {
            warnings.push({
                text: localize("TODO", "Can't resolve scripted GUI window {0} for inlay {1}.", inlay.windowName, inlay.id),
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

async function listGuiFiles(): Promise<string[]> {
    try {
        const files = await listFilesFromModOrHOI4(scriptedGuiFolder, { recursively: true });
        return files
            .filter(file => file.toLowerCase().endsWith(".gui"))
            .map(file => `${scriptedGuiFolder}/${file}`.replace(/\/+/g, "/"));
    } catch (e) {
        return [];
    }
}

async function listGuiGfxFiles(): Promise<string[]> {
    try {
        const files = await listFilesFromModOrHOI4(scriptedGuiFolder, { recursively: true });
        return files
            .filter(file => file.toLowerCase().endsWith(".gfx"))
            .map(file => `${scriptedGuiFolder}/${file}`.replace(/\/+/g, "/"));
    } catch (e) {
        return [];
    }
}

function collectContainerWindows(guiFile: HOIPartial<GuiFile>): Record<string, HOIPartial<ContainerWindowType>> {
    const result: Record<string, HOIPartial<ContainerWindowType>> = {};
    for (const guiTypes of guiFile.guitypes) {
        for (const containerWindow of [...guiTypes.containerwindowtype, ...guiTypes.windowtype]) {
            collectContainerWindowRecursive(containerWindow, result);
        }
    }
    return result;
}

function collectContainerWindowRecursive(containerWindow: HOIPartial<ContainerWindowType>, result: Record<string, HOIPartial<ContainerWindowType>>) {
    if (containerWindow.name && !(containerWindow.name in result)) {
        result[containerWindow.name] = containerWindow;
    }
    for (const child of [...containerWindow.containerwindowtype, ...containerWindow.windowtype]) {
        collectContainerWindowRecursive(child, result);
    }
}

export async function resolveInlayGfxFiles(inlays: FocusTreeInlay[]): Promise<InlayGfxResolution> {
    const roots = (getConfiguration().inlayWindowGfxRoots ?? []).filter((root): root is string => !!root && root.trim() !== "");
    const candidateFiles: string[] = [];
    for (const root of roots) {
        try {
            const files = await listFilesFromModOrHOI4(root.replace(/\\+/g, "/"), { recursively: true });
            for (const file of files) {
                if (file.toLowerCase().endsWith(".gfx")) {
                    candidateFiles.push(`${root.replace(/\\+/g, "/")}/${file}`.replace(/\/+/g, "/"));
                }
            }
        } catch (e) {
        }
    }

    const gfxFileByName: Record<string, string | undefined> = {};
    const resolvedFiles = new Set<string>();
    for (const candidateFile of candidateFiles) {
        try {
            const [buffer, uri] = await readFileFromModOrHOI4(candidateFile);
            const spriteTypes = getSpriteTypes(parseHoi4File(buffer.toString().replace(/^\uFEFF/, ""), localize("infile", "In file {0}:\n", uri.toString())));
            for (const spriteType of spriteTypes) {
                if (!(spriteType.name in gfxFileByName)) {
                    gfxFileByName[spriteType.name] = candidateFile;
                }
            }
        } catch (e) {
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

export function addInlayGfxWarnings(inlays: FocusTreeInlay[], warnings: FocusWarning[]) {
    for (const inlay of inlays) {
        for (const slot of inlay.scriptedImages) {
            for (const option of slot.gfxOptions) {
                if (!option.gfxFile) {
                    warnings.push({
                        text: localize("TODO", "Can't resolve inlay GFX {0} for slot {1} in inlay {2}.", option.gfxName, slot.id, inlay.id),
                        source: inlay.id,
                        navigations: option.token ? [{ file: option.file, start: option.token.start, end: option.token.end }] : undefined,
                    });
                }
            }
        }
    }
}

export function parseInlayWindowRef(node: Node, file: string): FocusTreeInlayRef | undefined {
    const idNode = Array.isArray(node.value) ? node.value.find(child => child.name?.toLowerCase() === "id") : undefined;
    const positionNode = Array.isArray(node.value) ? node.value.find(child => child.name?.toLowerCase() === "position") : undefined;
    const id = idNode ? convertNodeToJson<string>(idNode, "string") : undefined;
    const position = positionNode ? convertNodeToJson<Position>(positionNode, positionSchema) : undefined;
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
