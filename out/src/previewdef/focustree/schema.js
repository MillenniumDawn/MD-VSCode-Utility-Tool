"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertFocusFileNodeToJson = convertFocusFileNodeToJson;
exports.getFocusTreeWithFocusFile = getFocusTreeWithFocusFile;
exports.extractFocusIds = extractFocusIds;
exports.getFocusTree = getFocusTree;
const tslib_1 = require("tslib");
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("../../util/hoi4gui/common");
const lodash_1 = require("lodash");
const condition_1 = require("../../hoiformat/condition");
const scope_1 = require("../../hoiformat/scope");
const featureflags_1 = require("../../util/featureflags");
const common_2 = require("../../util/common");
const i18n_1 = require("../../util/i18n");
const path = tslib_1.__importStar(require("path"));
const inlay_1 = require("./inlay");
const focusOrORListSchema = {
    focus: {
        _innerType: "string",
        _type: 'array',
    },
    OR: {
        _innerType: "string",
        _type: 'array',
    },
};
const focusSchema = {
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
const focusTreeSchema = {
    id: "string",
    shared_focus: {
        _innerType: "string",
        _type: "array",
    },
    focus: {
        _innerType: focusSchema,
        _type: 'array',
    },
    continuous_focus_position: schema_1.positionSchema,
    inlay_window: {
        _innerType: 'raw',
        _type: 'array',
    },
};
const focusFileSchema = {
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
const focusIconSchema = {
    trigger: "raw",
    value: "string",
};
function convertFocusFileNodeToJson(node, constants) {
    return (0, schema_1.convertNodeToJson)(node, focusFileSchema, constants);
}
function getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants) {
    const focusTrees = [];
    if (file.shared_focus.length > 0) {
        const conditionExprs = [];
        const warnings = [];
        const focuses = getFocuses(file.shared_focus, conditionExprs, filePath, warnings, constants);
        const sharedFocusTree = {
            id: (0, i18n_1.localize)('focustree.sharedfocuses', '<Shared focuses>'),
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
        const conditionExprs = [];
        const warnings = [];
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
        const conditionExprs = [];
        const warnings = [];
        const focuses = getFocuses(focusTree.focus, conditionExprs, filePath, warnings, constants);
        if (featureflags_1.useConditionInFocus) {
            for (const sharedFocus of focusTree.shared_focus) {
                if (!sharedFocus) {
                    continue;
                }
                addSharedFocus(focuses, filePath, sharedFocusTrees, sharedFocus, conditionExprs, warnings);
            }
        }
        validateRelativePositionId(focuses, warnings);
        focusTrees.push({
            id: focusTree.id ?? (0, i18n_1.localize)('focustree.ananymous', '<Anonymous focus tree>'),
            focuses,
            inlayWindowRefs: focusTree.inlay_window
                .map(v => v?._raw)
                .filter((v) => v !== undefined)
                .map(v => (0, inlay_1.parseInlayWindowRef)(v, filePath))
                .filter((v) => v !== undefined),
            inlayWindows: [],
            inlayConditionExprs: [],
            allowBranchOptions: getAllowBranchOptions(focuses),
            continuousFocusPositionX: (0, common_1.normalizeNumberLike)(focusTree.continuous_focus_position?.x, 0) ?? 50,
            continuousFocusPositionY: (0, common_1.normalizeNumberLike)(focusTree.continuous_focus_position?.y, 0) ?? 1000,
            conditionExprs,
            isSharedFocues: false,
            warnings,
        });
    }
    return focusTrees;
}
function getJointFocusTreeId(filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const label = (0, i18n_1.localize)('TODO', '<Joint focus tree>');
    return fileName ? `${label} (${fileName})` : label;
}
/**
 * Lightweight ID-only extraction for the shared focus index.
 * Skips expensive per-focus parsing (icons, conditions, prerequisites)
 * that getFocusTree/getFocuses/getFocus would do.
 */
function extractFocusIds(node) {
    const constants = {};
    const file = convertFocusFileNodeToJson(node, constants);
    const ids = [];
    for (const tree of file.focus_tree) {
        for (const focus of tree.focus) {
            if (focus.id) {
                ids.push(focus.id);
            }
        }
    }
    for (const focus of file.shared_focus) {
        if (focus.id) {
            ids.push(focus.id);
        }
    }
    for (const focus of file.joint_focus) {
        if (focus.id) {
            ids.push(focus.id);
        }
    }
    return ids;
}
function getFocusTree(node, sharedFocusTrees, filePath) {
    const constants = {};
    const file = convertFocusFileNodeToJson(node, constants);
    return getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants);
}
function getFocuses(hoiFocuses, conditionExprs, filePath, warnings, constants) {
    const focuses = {};
    for (const hoiFocus of hoiFocuses) {
        const focus = getFocus(hoiFocus, conditionExprs, filePath, warnings, constants);
        if (focus !== null) {
            if (focus.id in focuses) {
                const otherFocus = focuses[focus.id];
                warnings.push({
                    text: (0, i18n_1.localize)('focustree.warnings.focusidconflict', "There're more than one focuses with ID {0} in file: {1}.", focus.id, filePath),
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
    const allowBranchDependents = new Map();
    for (const key in focuses) {
        const prereqs = (0, lodash_1.flatten)(focuses[key].prerequisite).filter(p => p in focuses);
        for (const p of prereqs) {
            if (!allowBranchDependents.has(p)) {
                allowBranchDependents.set(p, []);
            }
            allowBranchDependents.get(p).push(key);
        }
    }
    // Seed queue with focuses that have allowBranch
    const abQueue = [];
    for (const key in focuses) {
        if (focuses[key].hasAllowBranch) {
            abQueue.push(key);
        }
    }
    while (abQueue.length > 0) {
        const sourceKey = abQueue.shift();
        const source = focuses[sourceKey];
        const deps = allowBranchDependents.get(sourceKey);
        if (!deps) {
            continue;
        }
        for (const depKey of deps) {
            const dep = focuses[depKey];
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
function getFocus(hoiFocus, conditionExprs, filePath, warnings, constants) {
    const id = hoiFocus.id ?? `[missing_id_${(0, common_2.randomString)(8)}]`;
    if (!hoiFocus.id) {
        warnings.push({
            text: (0, i18n_1.localize)('focustree.warnings.focusnoid', "A focus defined in this file don't have ID: {0}.", filePath),
            source: id,
        });
    }
    const x = hoiFocus.x ?? 0;
    const y = hoiFocus.y ?? 0;
    const relativePositionId = hoiFocus.relative_position_id;
    const exclusive = (0, lodash_1.chain)(hoiFocus.mutually_exclusive)
        .flatMap(f => f.focus.concat(f.OR))
        .filter((s) => s !== undefined)
        .value();
    const prerequisite = hoiFocus.prerequisite
        .map(p => p.focus.concat(p.OR).filter((s) => s !== undefined));
    const icon = parseFocusIcon(hoiFocus.icon.filter((v) => v !== undefined).map(v => v._raw), constants, conditionExprs);
    const textIcon = hoiFocus.text_icon;
    const overlay = hoiFocus.overlay;
    const hasAllowBranch = hoiFocus.allow_branch.length > 0;
    const allowBranchCondition = (0, condition_1.extractConditionValues)(hoiFocus.allow_branch.filter((v) => v !== undefined).map(v => v._raw.value), scope_1.countryScope, conditionExprs).condition;
    const offset = hoiFocus.offset.map(o => ({
        x: o.x ?? 0,
        y: o.y ?? 0,
        trigger: o.trigger ? (0, condition_1.extractConditionValues)(o.trigger.filter((v) => v !== undefined).map(v => v._raw.value), scope_1.countryScope, conditionExprs).condition : false,
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
function addSharedFocus(focuses, filePath, sharedFocusTrees, sharedFocusId, conditionExprs, warnings) {
    const sharedFocusTree = sharedFocusTrees.find(sft => sharedFocusId in sft.focuses);
    if (!sharedFocusTree) {
        return;
    }
    const sharedFocuses = sharedFocusTree.focuses;
    // Build reverse dependency map: focus -> focuses that depend on it
    const dependents = new Map();
    // Track how many unresolved prerequisites each candidate has
    const unresolvedCount = new Map();
    for (const key in sharedFocuses) {
        if (key in focuses) {
            continue;
        }
        const prereqs = (0, lodash_1.flatten)(sharedFocuses[key].prerequisite).filter(p => p in sharedFocuses);
        if (prereqs.length === 0) {
            continue;
        }
        let unresolved = 0;
        for (const p of prereqs) {
            if (!(p in focuses)) {
                unresolved++;
                if (!dependents.has(p)) {
                    dependents.set(p, []);
                }
                dependents.get(p).push(key);
            }
        }
        unresolvedCount.set(key, unresolved);
    }
    // BFS: start from the requested shared focus, propagate to dependents
    const queue = [sharedFocusId];
    focuses[sharedFocusId] = sharedFocuses[sharedFocusId];
    updateConditionExprsByFocus(sharedFocuses[sharedFocusId], conditionExprs);
    while (queue.length > 0) {
        const added = queue.shift();
        const deps = dependents.get(added);
        if (!deps) {
            continue;
        }
        for (const dep of deps) {
            const count = (unresolvedCount.get(dep) ?? 1) - 1;
            unresolvedCount.set(dep, count);
            if (count <= 0 && !(dep in focuses)) {
                const focus = sharedFocuses[dep];
                if (focus.id in focuses) {
                    const otherFocus = focuses[focus.id];
                    warnings.push({
                        text: (0, i18n_1.localize)('focustree.warnings.focusidconflict2', "There're more than one focuses with ID {0} in files: {1}, {2}.", focus.id, filePath, focus.file),
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
function updateConditionExprsByFocus(focus, conditionExprs) {
    if (focus.allowBranch) {
        (0, condition_1.extractConditionalExprs)(focus.allowBranch, conditionExprs);
    }
    for (const offset of focus.offset) {
        if (offset.trigger) {
            (0, condition_1.extractConditionalExprs)(offset.trigger, conditionExprs);
        }
    }
    for (const icon of focus.icon) {
        (0, condition_1.extractConditionalExprs)(icon.condition, conditionExprs);
    }
}
function getAllowBranchOptions(focuses) {
    return (0, lodash_1.chain)(focuses)
        .filter(f => f.hasAllowBranch && f.allowBranch !== true)
        .map(f => f.id)
        .uniq()
        .value();
}
function validateRelativePositionId(focuses, warnings) {
    const relativePositionId = {};
    const relativePositionIdChain = [];
    const circularReported = {};
    for (const focus of Object.values(focuses)) {
        if (focus.relativePositionId === undefined) {
            continue;
        }
        if (!(focus.relativePositionId in focuses)) {
            warnings.push({
                text: (0, i18n_1.localize)('focustree.warnings.relativepositionidnotexist', 'Relative position ID of focus {0} not exist: {1}.', focus.id, focus.relativePositionId),
                source: focus.id,
            });
            continue;
        }
        relativePositionIdChain.length = 0;
        relativePositionId[focus.id] = focuses[focus.relativePositionId];
        let currentFocus = focus;
        while (currentFocus) {
            if (circularReported[currentFocus.id]) {
                break;
            }
            relativePositionIdChain.push(currentFocus.id);
            const nextFocus = relativePositionId[currentFocus.id];
            if (nextFocus && relativePositionIdChain.includes(nextFocus.id)) {
                relativePositionIdChain.forEach(r => circularReported[r] = true);
                relativePositionIdChain.push(nextFocus.id);
                warnings.push({
                    text: (0, i18n_1.localize)('focustree.warnings.relativepositioncircularref', "There're circular reference in relative position ID of these focuses: {0}.", relativePositionIdChain.join(' -> ')),
                    source: focus.id,
                });
                break;
            }
            currentFocus = nextFocus;
        }
    }
}
function parseFocusIcon(nodes, constants, conditionExprs) {
    return nodes.map(n => parseSingleFocusIcon(n, constants, conditionExprs)).filter((v) => v !== undefined);
}
function parseSingleFocusIcon(node, constants, conditionExprs) {
    const stringResult = (0, schema_1.convertNodeToJson)(node, 'string', constants);
    if (stringResult) {
        return { icon: stringResult, condition: true };
    }
    const iconWithCondition = (0, schema_1.convertNodeToJson)(node, focusIconSchema, constants);
    return {
        icon: iconWithCondition.value,
        condition: iconWithCondition.trigger ? (0, condition_1.extractConditionValue)(iconWithCondition.trigger._raw.value, scope_1.countryScope, conditionExprs).condition : true,
    };
}
//# sourceMappingURL=schema.js.map