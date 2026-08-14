import { Node, Token } from "../../hoiformat/hoiparser";
import { HOIPartial, SchemaDef, Position, convertNodeToJson, positionSchema, Raw, isSymbolNode } from "../../hoiformat/schema";
import { normalizeNumberLike } from "../../util/hoi4gui/common";
import { flatten, chain } from 'lodash';
import { ConditionItem, ConditionComplexExpr, extractConditionValues, extractConditionValue, extractConditionalExprs } from "../../hoiformat/condition";
import { countryScope } from "../../hoiformat/scope";
import { useConditionInFocus } from "../../util/featureflags";
import { randomString, Warning } from "../../util/common";
import { localize } from "../../util/i18n";
import * as path from 'path';
import { parseInlayWindowRef } from "./inlay";
import { ContainerWindowType } from "../../hoiformat/gui";

export interface FocusTree {
    id: string;
    focuses: Record<string, Focus>;
    inlayWindowRefs: FocusTreeInlayRef[];
    inlayWindows: FocusTreeInlay[];
    inlayConditionExprs: ConditionItem[];
    allowBranchOptions: string[];
    conditionExprs: ConditionItem[];
    isSharedFocues: boolean;
    continuousFocusPositionX?: number;
    continuousFocusPositionY?: number;
    warnings: FocusWarning[];
}

interface FocusIconWithCondition {
    icon: string | undefined;
    condition: ConditionComplexExpr;
}

export interface Focus {
    x: number;
    y: number;
    id: string;
    icon: FocusIconWithCondition[];
    textIcon?: string;
    overlay?: string;
    prerequisite: string[][];
    exclusive: string[];
    hasAllowBranch: boolean;
    inAllowBranch: string[];
    allowBranch: ConditionComplexExpr | undefined;
    relativePositionId: string | undefined;
    offset: Offset[];
    token: Token | undefined;
    file: string;
    text?: string;
}

export interface FocusWarning extends Warning<string> {
    navigations?: { file: string, start: number, end: number }[];
    // Other focuses involved in this warning (e.g. the other focus of a pair), so the webview
    // can highlight every offender instead of only the warning's source.
    relatedSources?: string[];
}

export interface FocusTreeInlayRef {
    id: string;
    position: { x: number; y: number; };
    file: string;
    token: Token | undefined;
}

export interface FocusTreeInlay {
    id: string;
    file: string;
    token: Token | undefined;
    windowName?: string;
    guiFile?: string;
    guiWindow?: HOIPartial<ContainerWindowType>;
    internal: boolean;
    visible: ConditionComplexExpr;
    position: { x: number; y: number; };
    scriptedImages: FocusInlayImageSlot[];
    scriptedButtons: FocusTreeInlayButtonMeta[];
    conditionExprs: ConditionItem[];
}

export interface FocusInlayImageSlot {
    id: string;
    file: string;
    token: Token | undefined;
    gfxOptions: FocusInlayGfxOption[];
}

export interface FocusInlayGfxOption {
    gfxName: string;
    condition: ConditionComplexExpr;
    file: string;
    token: Token | undefined;
    gfxFile?: string;
}

export interface FocusTreeInlayButtonMeta {
    id: string;
    file: string;
    token: Token | undefined;
    available?: ConditionComplexExpr;
}

interface Offset {
    x: number;
    y: number;
    trigger: ConditionComplexExpr | undefined;
}

interface FocusTreeDef {
    id: string;
    shared_focus: string[];
    focus: FocusDef[];
    continuous_focus_position: Position;
    inlay_window: Raw[];
}

interface FocusDef {
    id: string;
    icon: Raw[];
    text_icon: string;
    overlay: string;
    x: number;
    y: number;
    prerequisite: FocusOrORList[];
    mutually_exclusive: FocusOrORList[];
    relative_position_id: string;
    allow_branch: Raw[]; /* FIXME not symbol node */
    offset: OffsetDef[];
    _token: Token;
    text?: string;
}

interface FocusIconDef {
    trigger: Raw;
    value: string;
}

interface OffsetDef {
    x: number;
    y: number;
    trigger: Raw[];
}

interface FocusOrORList {
    focus: string[];
    // Raw node list: an OR block's contents cannot be expressed with the plain string schema
    // (a block converts via convertString to undefined), so extractOrListIds walks them.
    or: Raw[];
}

interface FocusFile {
    focus_tree: FocusTreeDef[];
    shared_focus: FocusDef[];
    joint_focus: FocusDef[];
}

const focusOrORListSchema: SchemaDef<FocusOrORList> = {
    focus: {
        _innerType: "string",
        _type: 'array',
    },
    // Schema keys are matched against lowercased file keys, so this must be lowercase.
    or: {
        _innerType: 'raw',
        _type: 'array',
    },
};

const focusSchema: SchemaDef<FocusDef> = {
    id: "string",
    icon: {
        _innerType: 'raw',
        _type: 'array',
    },
    text_icon: "string",
    overlay: "string",
    x: "number",
    y: "number",
    prerequisite: {
        _innerType: focusOrORListSchema,
        _type: 'array',
    },
    mutually_exclusive: {
        _innerType: focusOrORListSchema,
        _type: 'array',
    },
    relative_position_id: "string",
    allow_branch: {
        _innerType: 'raw',
        _type: 'array',
    },
    offset: {
        _innerType: {
            x: "number",
            y: "number",
            trigger: {
                _innerType: 'raw',
                _type: 'array',
            },
        },
        _type: 'array',
    },
    text: "string",
};

const focusTreeSchema: SchemaDef<FocusTreeDef> = {
    id: "string",
    shared_focus: {
        _innerType: "string",
        _type: "array",
    },
    focus: {
        _innerType: focusSchema,
        _type: 'array',
    },
    continuous_focus_position: positionSchema,
    inlay_window: {
        _innerType: 'raw',
        _type: 'array',
    },
};

const focusFileSchema: SchemaDef<FocusFile> = {
    focus_tree: {
        _innerType: focusTreeSchema,
        _type: "array",
    },
    shared_focus: {
        _innerType: focusSchema,
        _type: "array",
    },
    joint_focus: {
        _innerType: focusSchema,
        _type: "array",
    },
};

const focusIconSchema: SchemaDef<FocusIconDef> = {
    trigger: "raw",
    value: "string",
};

export function convertFocusFileNodeToJson(node: Node, constants: {}): HOIPartial<FocusFile> {
    return convertNodeToJson<FocusFile>(node, focusFileSchema, constants);
}

export function getFocusTreeWithFocusFile(file: HOIPartial<FocusFile>, sharedFocusTrees: FocusTree[], filePath: string, constants: {} ): FocusTree[] {
    const focusTrees: FocusTree[] = [];
    if (file.shared_focus.length > 0) {
        const conditionExprs: ConditionItem[] = [];
        const warnings: FocusWarning[] = [];
        const focuses = getFocuses(file.shared_focus, conditionExprs, filePath, warnings, constants);
        const sharedFocusTree = {
            id: localize('focustree.sharedfocuses', '<Shared focuses>'),
            focuses,
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            conditionExprs,
            isSharedFocues: true,
            warnings,
        };
        focusTrees.push(sharedFocusTree);
        sharedFocusTrees = [sharedFocusTree, ...sharedFocusTrees];
    }

    if (file.joint_focus.length > 0) {
        const conditionExprs: ConditionItem[] = [];
        const warnings: FocusWarning[] = [];
        const focuses = getFocuses(file.joint_focus, conditionExprs, filePath, warnings, constants);

        focusTrees.push({
            id: getJointFocusTreeId(filePath),
            focuses,
            inlayWindowRefs: [],
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            conditionExprs,
            isSharedFocues: false,
            warnings,
        });
    }

    for (const focusTree of file.focus_tree) {
        const conditionExprs: ConditionItem[] = [];
        const warnings: FocusWarning[] = [];
        const focuses = getFocuses(focusTree.focus, conditionExprs, filePath, warnings, constants);

        if (useConditionInFocus) {
            for (const sharedFocus of focusTree.shared_focus) {
                if (!sharedFocus) {
                    continue;
                }
                addSharedFocus(focuses, filePath, sharedFocusTrees, sharedFocus, conditionExprs, warnings);
            }
        }

        validateRelativePositionId(focuses, warnings);
        validateFocusLayout(focuses, warnings, filePath);

        focusTrees.push({
            id: focusTree.id ?? localize('focustree.ananymous', '<Anonymous focus tree>'),
            focuses,
            inlayWindowRefs: focusTree.inlay_window
                .map(v => v?._raw)
                .filter((v): v is Node => v !== undefined)
                .map(v => parseInlayWindowRef(v, filePath))
                .filter((v): v is FocusTreeInlayRef => v !== undefined),
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            continuousFocusPositionX: normalizeNumberLike(focusTree.continuous_focus_position?.x, 0) ?? 50,
            continuousFocusPositionY: normalizeNumberLike(focusTree.continuous_focus_position?.y, 0) ?? 1000,
            conditionExprs,
            isSharedFocues: false,
            warnings,
        });
    }

    return focusTrees;
}

function getJointFocusTreeId(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    const label = localize('focustree.jointfocustree', '<Joint focus tree>');
    return fileName ? `${label} (${fileName})` : label;
}

/**
 * Lightweight ID-only extraction for the shared focus index.
 * Skips expensive per-focus parsing (icons, conditions, prerequisites)
 * that getFocusTree/getFocuses/getFocus would do.
 */
export function extractFocusIds(node: Node): string[] {
    const constants = {};
    const file = convertFocusFileNodeToJson(node, constants);
    const ids: string[] = [];

    for (const tree of file.focus_tree) {
        for (const focus of tree.focus) {
            if (focus.id) { ids.push(focus.id); }
        }
    }
    for (const focus of file.shared_focus) {
        if (focus.id) { ids.push(focus.id); }
    }
    for (const focus of file.joint_focus) {
        if (focus.id) { ids.push(focus.id); }
    }

    return ids;
}

export function getFocusTree(node: Node, sharedFocusTrees: FocusTree[], filePath: string): FocusTree[] {
    const constants = {};
    const file = convertFocusFileNodeToJson(node, constants);

    return getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants);
}

function getFocuses(hoiFocuses: HOIPartial<FocusDef>[], conditionExprs: ConditionItem[], filePath: string, warnings: FocusWarning[], constants: {}): Record<string, Focus> {
    const focuses: Record<string, Focus> = {};

    for (const hoiFocus of hoiFocuses) {
        const focus = getFocus(hoiFocus, conditionExprs, filePath, warnings, constants);
        if (focus !== null) {
            if (focus.id in focuses) {
                const otherFocus = focuses[focus.id];
                if (!otherFocus) {
                    continue;
                }
                warnings.push({
                    text: localize('focustree.warnings.focusidconflict', "There're more than one focuses with ID {0} in file: {1}.", focus.id, filePath),
                    source: focus.id,
                    navigations: [
                        {
                            file: filePath,
                            start: focus.token?.start ?? 0,
                            end: focus.token?.end ?? 0,
                        },
                        {
                            file: filePath,
                            start: otherFocus.token?.start ?? 0,
                            end: otherFocus.token?.end ?? 0,
                        },
                    ]
                });
            }
            focuses[focus.id] = focus;
        }
    }

    // Propagate inAllowBranch from prerequisites to dependents via BFS
    // Build reverse map: prerequisite -> focuses that depend on it
    const allowBranchDependents = new Map<string, string[]>();
    for (const key in focuses) {
        const focus = focuses[key];
        if (!focus) {
            continue;
        }
        const prereqs = flatten(focus.prerequisite).filter(p => p in focuses);
        for (const p of prereqs) {
            if (!allowBranchDependents.has(p)) { allowBranchDependents.set(p, []); }
            allowBranchDependents.get(p)!.push(key);
        }
    }

    // Seed queue with focuses that have allowBranch
    const abQueue: string[] = [];
    for (const key in focuses) {
        if (focuses[key]?.hasAllowBranch) {
            abQueue.push(key);
        }
    }

    while (abQueue.length > 0) {
        const sourceKey = abQueue.shift()!;
        const source = focuses[sourceKey];
        const deps = allowBranchDependents.get(sourceKey);
        if (!source || !deps) { continue; }
        for (const depKey of deps) {
            const dep = focuses[depKey];
            if (!dep) {
                continue;
            }
            let changed = false;
            for (const ab of source.inAllowBranch) {
                if (!dep.inAllowBranch.includes(ab)) {
                    dep.inAllowBranch.push(ab);
                    changed = true;
                }
            }
            if (changed) {
                abQueue.push(depKey);
            }
        }
    }

    return focuses;
}

function getFocus(hoiFocus: HOIPartial<FocusDef>, conditionExprs: ConditionItem[], filePath: string, warnings: FocusWarning[], constants: {}): Focus | null {
    const id = hoiFocus.id ?? `[missing_id_${randomString(8)}]`;

    if (!hoiFocus.id) {
        warnings.push({
            text: localize('focustree.warnings.focusnoid', "A focus defined in this file don't have ID: {0}.", filePath),
            source: id,
        });
    }

    const x = hoiFocus.x ?? 0;
    const y = hoiFocus.y ?? 0;
    const relativePositionId = hoiFocus.relative_position_id;

    const exclusive = chain(hoiFocus.mutually_exclusive)
        .flatMap(f => f.focus.concat(extractOrListIds(f.or)))
        .filter((s): s is string => s !== undefined)
        .value();
    const prerequisite = hoiFocus.prerequisite
        .map(p => p.focus.concat(extractOrListIds(p.or)).filter((s): s is string => s !== undefined));
    const icon = parseFocusIcon(hoiFocus.icon.filter((v): v is Raw => v !== undefined).map(v => v._raw), constants, conditionExprs);
    const textIcon = hoiFocus.text_icon;
    const overlay = hoiFocus.overlay;
    const hasAllowBranch = hoiFocus.allow_branch.length > 0;
    const allowBranchCondition = extractConditionValues(hoiFocus.allow_branch.filter((v): v is Raw => v !== undefined).map(v => v._raw.value), countryScope, conditionExprs).condition;
    const offset: Offset[] = hoiFocus.offset.map(o => ({
        x: o.x ?? 0,
        y: o.y ?? 0,
        trigger: o.trigger ? extractConditionValues(o.trigger.filter((v): v is Raw => v !== undefined).map(v => v._raw.value), countryScope, conditionExprs).condition : false,
    }));

    const text = hoiFocus.text;

    return {
        id,
        icon,
        textIcon,
        overlay,
        x,
        y,
        relativePositionId,
        prerequisite,
        exclusive,
        hasAllowBranch,
        inAllowBranch: hasAllowBranch ? [id] : [],
        allowBranch: allowBranchCondition,
        offset,
        token: hoiFocus._token,
        file: filePath,
        text,
    };
}

function addSharedFocus(focuses: Record<string, Focus>, filePath: string, sharedFocusTrees: FocusTree[], sharedFocusId: string, conditionExprs: ConditionItem[], warnings: FocusWarning[]) {
    const sharedFocusTree = sharedFocusTrees.find(sft => sharedFocusId in sft.focuses);
    if (!sharedFocusTree) {
        return;
    }

    const sharedFocuses = sharedFocusTree.focuses;

    // Build reverse dependency map: focus -> focuses that depend on it
    const dependents = new Map<string, string[]>();
    // Track how many unresolved prerequisites each candidate has
    const unresolvedCount = new Map<string, number>();

    for (const key in sharedFocuses) {
        if (key in focuses) { continue; }
        const focus = sharedFocuses[key];
        if (!focus) {
            continue;
        }
        const prereqs = flatten(focus.prerequisite).filter(p => p in sharedFocuses);
        if (prereqs.length === 0) { continue; }
        let unresolved = 0;
        for (const p of prereqs) {
            if (!(p in focuses)) {
                unresolved++;
                if (!dependents.has(p)) { dependents.set(p, []); }
                dependents.get(p)!.push(key);
            }
        }
        unresolvedCount.set(key, unresolved);
    }

    // BFS: start from the requested shared focus, propagate to dependents
    const queue: string[] = [sharedFocusId];
    const sharedFocus = sharedFocuses[sharedFocusId];
    if (!sharedFocus) {
        return;
    }
    focuses[sharedFocusId] = sharedFocus;
    updateConditionExprsByFocus(sharedFocus, conditionExprs);

    while (queue.length > 0) {
        const added = queue.shift()!;
        const deps = dependents.get(added);
        if (!deps) { continue; }
        for (const dep of deps) {
            const count = (unresolvedCount.get(dep) ?? 1) - 1;
            unresolvedCount.set(dep, count);
            if (count <= 0 && !(dep in focuses)) {
                const focus = sharedFocuses[dep];
                if (!focus) {
                    continue;
                }
                if (focus.id in focuses) {
                    const otherFocus = focuses[focus.id];
                    if (!otherFocus) {
                        continue;
                    }
                    warnings.push({
                        text: localize('focustree.warnings.focusidconflict2', "There're more than one focuses with ID {0} in files: {1}, {2}.", focus.id, filePath, focus.file),
                        source: focus.id,
                        navigations: [
                            {
                                file: focus.file,
                                start: focus.token?.start ?? 0,
                                end: focus.token?.end ?? 0,
                            },
                            {
                                file: filePath,
                                start: otherFocus.token?.start ?? 0,
                                end: otherFocus.token?.end ?? 0,
                            },
                        ]
                    });
                }
                focuses[dep] = focus;
                updateConditionExprsByFocus(focus, conditionExprs);
                queue.push(dep);
            }
        }
    }

    for (const warning of sharedFocusTree.warnings) {
        if (warning.source in focuses) {
            warnings.push(warning);
        }
    }
}

function updateConditionExprsByFocus(focus: Focus, conditionExprs: ConditionItem[]) {
    if (focus.allowBranch) {
        extractConditionalExprs(focus.allowBranch, conditionExprs);
    }

    for (const offset of focus.offset) {
        if (offset.trigger) {
            extractConditionalExprs(offset.trigger, conditionExprs);
        }
    }

    for (const icon of focus.icon) {
        extractConditionalExprs(icon.condition, conditionExprs);
    }
}

function getAllowBranchOptions(focuses: Record<string, Focus>): string[] {
    return chain(focuses)
        .filter(f => f.hasAllowBranch && f.allowBranch !== true)
        .map(f => f.id)
        .uniq()
        .value();
}

function resolveFocusPosition(focus: Focus, focuses: Record<string, Focus>): { x: number; y: number } {
    // Mirrors the webview's getFocusPosition without the condition-dependent offset pass:
    // the resolved position is the focus's own x/y plus the resolved position of the
    // relative_position_id chain. Cycles are cut (validateRelativePositionId reports them).
    let x = focus.x;
    let y = focus.y;
    const seen = new Set<string>([focus.id]);
    let current = focus.relativePositionId !== undefined ? focuses[focus.relativePositionId] : undefined;
    while (current !== undefined && !seen.has(current.id)) {
        x += current.x;
        y += current.y;
        seen.add(current.id);
        current = current.relativePositionId !== undefined ? focuses[current.relativePositionId] : undefined;
    }
    return { x, y };
}

/**
 * Layout checks for the common focus-tree mistakes that make the game render a broken tree:
 * a prerequisite not positioned above its dependent, mutually exclusive focuses not sharing an X,
 * and icons less than two grid units apart on the same row (the sprites are two units wide, so
 * they overlap). Positions are resolved through relative_position_id chains like the preview does;
 * condition-dependent offsets are ignored.
 */
function validateFocusLayout(focuses: Record<string, Focus>, warnings: FocusWarning[], filePath: string) {
    // Only focuses defined in the tree's own file participate. Shared focuses merged in via
    // addSharedFocus live in other files and their stored x/y is the shared_focus block's
    // (defaulting to 0,0), so comparing them against real focuses would raise false positives.
    const entries = Object.values(focuses)
        .filter(focus => focus.file === filePath)
        .map(focus => ({ focus, position: resolveFocusPosition(focus, focuses) }));
    const positions = new Map(entries.map(entry => [entry.focus.id, entry.position] as const));

    const reportedPairs = new Set<string>();
    const pairKey = (a: string, b: string) => a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;

    for (const { focus, position } of entries) {
        // An OR-group prerequisite is satisfied by completing any one of its focuses, so it is
        // only a layout problem when none of the group's options sits above the dependent.
        for (const group of focus.prerequisite) {
            const options = group.filter(p => {
                const prerequisite = focuses[p];
                return p !== focus.id && prerequisite !== undefined && prerequisite.file === filePath;
            });
            const anyAbove = options.some(p => {
                const optionPosition = positions.get(p);
                return optionPosition !== undefined && optionPosition.y < position.y;
            });
            if (options.length > 0 && !anyAbove) {
                warnings.push({
                    text: localize('focustree.warnings.prerequisitenotabove', 'Prerequisite {0} of focus {1} is not positioned above it.', options.join(', '), focus.id),
                    source: focus.id,
                    relatedSources: options,
                });
            }
        }

        // Mutually exclusive focuses are alternatives in the same tree slot, so they must share an X.
        for (const exclusive of focus.exclusive) {
            const exclusiveFocus = focuses[exclusive];
            if (exclusive === focus.id || exclusiveFocus === undefined || exclusiveFocus.file !== filePath) {
                continue;
            }
            const key = pairKey(focus.id, exclusive);
            if (reportedPairs.has(key)) {
                continue;
            }
            reportedPairs.add(key);
            const exclusivePosition = positions.get(exclusive);
            if (exclusivePosition !== undefined && exclusivePosition.x !== position.x) {
                warnings.push({
                    text: localize('focustree.warnings.exclusivenotsamex', 'Mutually exclusive focuses {0} and {1} are not on the same X position.', focus.id, exclusive),
                    source: focus.id,
                    relatedSources: [exclusive],
                });
            }
        }
    }

    // Focuses stacked on the exact same resolved position collapse into one warning each, so a
    // pile of focuses on one spot emits a single line instead of one per pair.
    const stacks = new Map<string, string[]>();
    for (const { focus, position } of entries) {
        const key = `${position.x}\u0001${position.y}`;
        const stack = stacks.get(key);
        if (stack === undefined) {
            stacks.set(key, [focus.id]);
        } else {
            stack.push(focus.id);
        }
    }
    for (const stack of stacks.values()) {
        const first = stack[0];
        if (stack.length > 1 && first !== undefined) {
            warnings.push({
                text: localize('focustree.warnings.sameposition', 'Focuses {0} share the same position, so their icons overlap.', stack.join(', ')),
                source: first,
                relatedSources: stack.slice(1),
            });
        }
    }

    // Focus icons span two grid columns, so the remaining same-row pairs need at least two X
    // units between them or the sprites overlap. Same-position pairs are covered by the stacks.
    for (let i = 0; i < entries.length; i++) {
        const entryA = entries[i];
        if (entryA === undefined) {
            continue;
        }
        for (let j = i + 1; j < entries.length; j++) {
            const entryB = entries[j];
            if (entryB === undefined) {
                continue;
            }
            if (entryA.position.y !== entryB.position.y || entryA.position.x === entryB.position.x) {
                continue;
            }
            if (Math.abs(entryA.position.x - entryB.position.x) < 2) {
                warnings.push({
                    text: localize('focustree.warnings.overlap', 'Focuses {0} and {1} are less than 2 apart on the same row, so their icons overlap.', entryA.focus.id, entryB.focus.id),
                    source: entryA.focus.id,
                    relatedSources: [entryB.focus.id],
                });
            }
        }
    }
}

function validateRelativePositionId(focuses: Record<string, Focus>, warnings: FocusWarning[]) {
    const relativePositionId: Record<string, Focus | undefined> = {};
    const relativePositionIdChain: string[] = [];
    const circularReported: Record<string, boolean> = {};

    for (const focus of Object.values(focuses)) {
        if (focus.relativePositionId === undefined) {
            continue;
        }

        if (!(focus.relativePositionId in focuses)) {
            warnings.push({
                text: localize('focustree.warnings.relativepositionidnotexist', 'Relative position ID of focus {0} not exist: {1}.', focus.id, focus.relativePositionId),
                source: focus.id,
            });
            continue;
        }

        relativePositionIdChain.length = 0;
        relativePositionId[focus.id] = focuses[focus.relativePositionId];
        let currentFocus: Focus | undefined = focus;
        while (currentFocus) {
            if (circularReported[currentFocus.id]) {
                break;
            }

            relativePositionIdChain.push(currentFocus.id);
            const nextFocus: Focus | undefined = relativePositionId[currentFocus.id];
            if (nextFocus && relativePositionIdChain.includes(nextFocus.id)) {
                relativePositionIdChain.forEach(r => circularReported[r] = true);
                relativePositionIdChain.push(nextFocus.id);
                warnings.push({
                    text: localize('focustree.warnings.relativepositioncircularref', "There're circular reference in relative position ID of these focuses: {0}.", relativePositionIdChain.join(' -> ')),
                    source: focus.id,
                });
                break;
            }
            currentFocus = nextFocus;
        }
    }
}

function nodeValueToString(value: Node['value']): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    return isSymbolNode(value) ? value.name : undefined;
}

/**
 * Reads the focus ids out of a prerequisite/mutually_exclusive OR block. The plain string
 * schema cannot express an OR block (a block value converts via convertString to undefined),
 * so the OR entries are kept raw and walked here. Both HOI4 spellings are accepted:
 * OR = { focus_a focus_b } and OR = { focus = focus_a focus = focus_b }.
 */
function extractOrListIds(orList: (Raw | undefined)[]): string[] {
    return flatten(orList
        .map(v => v?._raw)
        .filter((v): v is Node => v !== undefined)
        .map(node => {
            const value = node.value;
            if (Array.isArray(value)) {
                return value
                    .map(child => child.name === 'focus' ? nodeValueToString(child.value) : child.name)
                    .filter((v): v is string => typeof v === 'string');
            }
            const single = nodeValueToString(value);
            return single !== undefined ? [single] : [];
        }));
}

function parseFocusIcon(nodes: Node[], constants: {}, conditionExprs: ConditionItem[]): FocusIconWithCondition[] {
    return flatten(nodes.map(n => parseSingleFocusIcon(n, constants, conditionExprs)));
}

function parseSingleFocusIcon(node: Node, constants: {}, conditionExprs: ConditionItem[]): FocusIconWithCondition[] {
    // Simple form: icon = GFX_focus_x
    const stringResult = convertNodeToJson<string>(node, 'string', constants);
    if (stringResult) {
        return [{ icon: stringResult, condition: true }];
    }

    const children = Array.isArray(node.value) ? node.value : [];

    // Old block form: icon = { trigger = { ... }  value = GFX_focus_x }
    if (children.some(c => c.name === 'value')) {
        const iconWithCondition = convertNodeToJson<FocusIconDef>(node, focusIconSchema, constants);
        return [{
            icon: iconWithCondition.value,
            condition: iconWithCondition.trigger ? extractConditionValue(iconWithCondition.trigger._raw.value, countryScope, conditionExprs).condition : true,
        }];
    }

    // New block form (HOI4 1.19+): icon = { GFX_focus_x = { <triggers> }  GFX_focus_y = yes }
    // Each child names a GFX sprite; a block value holds its triggers, `= yes` marks the default.
    // Source order is preserved so the first matching condition wins on the client (the `= yes`
    // default is conventionally last and always matches).
    return children
        .filter((c): c is Node & { name: string } => c.name !== null)
        .map(c => Array.isArray(c.value)
            ? { icon: c.name, condition: extractConditionValue(c.value, countryScope, conditionExprs).condition }
            : { icon: c.name, condition: true });
}
