"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFocusTree = exports.getFocusTreeWithFocusFile = exports.convertFocusFileNodeToJson = void 0;
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("../../util/hoi4gui/common");
const lodash_1 = require("lodash");
const condition_1 = require("../../hoiformat/condition");
const scope_1 = require("../../hoiformat/scope");
const featureflags_1 = require("../../util/featureflags");
const common_2 = require("../../util/common");
const i18n_1 = require("../../util/i18n");
const path = require("path");
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
exports.convertFocusFileNodeToJson = convertFocusFileNodeToJson;
function getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants) {
    var _a, _b, _c, _d, _e;
    const focusTrees = [];
    const isJointFocusOnlyFile = file.focus_tree.length === 0 && file.shared_focus.length === 0 && file.joint_focus.length > 0;
    if (file.shared_focus.length > 0) {
        const conditionExprs = [];
        const warnings = [];
        const focuses = getFocuses(file.shared_focus, conditionExprs, filePath, warnings, constants);
        const sharedFocusTree = {
            id: (0, i18n_1.localize)('focustree.sharedfocuses', '<Shared focuses>'),
            focuses,
            allowBranchOptions: getAllowBranchOptions(focuses),
            conditionExprs,
            isSharedFocues: true,
            warnings,
        };
        focusTrees.push(sharedFocusTree);
        sharedFocusTrees = [sharedFocusTree, ...sharedFocusTrees];
    }
    if (isJointFocusOnlyFile) {
        const conditionExprs = [];
        const warnings = [];
        const focuses = getFocuses(file.joint_focus, conditionExprs, filePath, warnings, constants);
        focusTrees.push({
            id: getJointFocusTreeId(filePath),
            focuses,
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
            id: (_a = focusTree.id) !== null && _a !== void 0 ? _a : (0, i18n_1.localize)('focustree.ananymous', '<Anonymous focus tree>'),
            focuses,
            allowBranchOptions: getAllowBranchOptions(focuses),
            continuousFocusPositionX: (_c = (0, common_1.normalizeNumberLike)((_b = focusTree.continuous_focus_position) === null || _b === void 0 ? void 0 : _b.x, 0)) !== null && _c !== void 0 ? _c : 50,
            continuousFocusPositionY: (_e = (0, common_1.normalizeNumberLike)((_d = focusTree.continuous_focus_position) === null || _d === void 0 ? void 0 : _d.y, 0)) !== null && _e !== void 0 ? _e : 1000,
            conditionExprs,
            isSharedFocues: false,
            warnings,
        });
    }
    return focusTrees;
}
exports.getFocusTreeWithFocusFile = getFocusTreeWithFocusFile;
function getJointFocusTreeId(filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const label = (0, i18n_1.localize)('TODO', '<Joint focus tree>');
    return fileName ? `${label} (${fileName})` : label;
}
function getFocusTree(node, sharedFocusTrees, filePath) {
    const constants = {};
    const file = convertFocusFileNodeToJson(node, constants);
    return getFocusTreeWithFocusFile(file, sharedFocusTrees, filePath, constants);
}
exports.getFocusTree = getFocusTree;
function getFocuses(hoiFocuses, conditionExprs, filePath, warnings, constants) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
                            start: (_b = (_a = focus.token) === null || _a === void 0 ? void 0 : _a.start) !== null && _b !== void 0 ? _b : 0,
                            end: (_d = (_c = focus.token) === null || _c === void 0 ? void 0 : _c.end) !== null && _d !== void 0 ? _d : 0,
                        },
                        {
                            file: filePath,
                            start: (_f = (_e = otherFocus.token) === null || _e === void 0 ? void 0 : _e.start) !== null && _f !== void 0 ? _f : 0,
                            end: (_h = (_g = otherFocus.token) === null || _g === void 0 ? void 0 : _g.end) !== null && _h !== void 0 ? _h : 0,
                        },
                    ]
                });
            }
            focuses[focus.id] = focus;
        }
    }
    let hasChangedInAllowBranch = true;
    while (hasChangedInAllowBranch) {
        hasChangedInAllowBranch = false;
        for (const key in focuses) {
            const focus = focuses[key];
            const allPrerequisites = (0, lodash_1.flatten)(focus.prerequisite).filter(p => p in focuses);
            if (allPrerequisites.length === 0) {
                continue;
            }
            (0, lodash_1.chain)(allPrerequisites)
                .flatMap(p => focuses[p].inAllowBranch)
                .forEach(ab => {
                if (!focus.inAllowBranch.includes(ab)) {
                    focus.inAllowBranch.push(ab);
                    hasChangedInAllowBranch = true;
                }
            })
                .value();
        }
    }
    return focuses;
}
function getFocus(hoiFocus, conditionExprs, filePath, warnings, constants) {
    var _a, _b, _c;
    const id = (_a = hoiFocus.id) !== null && _a !== void 0 ? _a : `[missing_id_${(0, common_2.randomString)(8)}]`;
    if (!hoiFocus.id) {
        warnings.push({
            text: (0, i18n_1.localize)('focustree.warnings.focusnoid', "A focus defined in this file don't have ID: {0}.", filePath),
            source: id,
        });
    }
    const x = (_b = hoiFocus.x) !== null && _b !== void 0 ? _b : 0;
    const y = (_c = hoiFocus.y) !== null && _c !== void 0 ? _c : 0;
    const relativePositionId = hoiFocus.relative_position_id;
    const exclusive = (0, lodash_1.chain)(hoiFocus.mutually_exclusive)
        .flatMap(f => f.focus.concat(f.OR))
        .filter((s) => s !== undefined)
        .value();
    const prerequisite = hoiFocus.prerequisite
        .map(p => p.focus.concat(p.OR).filter((s) => s !== undefined));
    const icon = parseFocusIcon(hoiFocus.icon.filter((v) => v !== undefined).map(v => v._raw), constants, conditionExprs);
    const textIcon = hoiFocus.text_icon;
    const hasAllowBranch = hoiFocus.allow_branch.length > 0;
    const allowBranchCondition = (0, condition_1.extractConditionValues)(hoiFocus.allow_branch.filter((v) => v !== undefined).map(v => v._raw.value), scope_1.countryScope, conditionExprs).condition;
    const offset = hoiFocus.offset.map(o => {
        var _a, _b;
        return ({
            x: (_a = o.x) !== null && _a !== void 0 ? _a : 0,
            y: (_b = o.y) !== null && _b !== void 0 ? _b : 0,
            trigger: o.trigger ? (0, condition_1.extractConditionValues)(o.trigger.filter((v) => v !== undefined).map(v => v._raw.value), scope_1.countryScope, conditionExprs).condition : false,
        });
    });
    const text = hoiFocus.text;
    return {
        id,
        icon,
        textIcon,
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const sharedFocusTree = sharedFocusTrees.find(sft => sharedFocusId in sft.focuses);
    if (!sharedFocusTree) {
        return;
    }
    const sharedFocuses = sharedFocusTree.focuses;
    focuses[sharedFocusId] = sharedFocuses[sharedFocusId];
    updateConditionExprsByFocus(sharedFocuses[sharedFocusId], conditionExprs);
    let hasChanged = true;
    while (hasChanged) {
        hasChanged = false;
        for (const key in sharedFocuses) {
            if (key in focuses) {
                continue;
            }
            const focus = sharedFocuses[key];
            const allPrerequisites = (0, lodash_1.flatten)(focus.prerequisite).filter(p => p in sharedFocuses);
            if (allPrerequisites.length === 0) {
                continue;
            }
            if (allPrerequisites.every(p => p in focuses)) {
                if (focus.id in focuses) {
                    const otherFocus = focuses[focus.id];
                    warnings.push({
                        text: (0, i18n_1.localize)('focustree.warnings.focusidconflict2', "There're more than one focuses with ID {0} in files: {1}, {2}.", focus.id, filePath, focus.file),
                        source: focus.id,
                        navigations: [
                            {
                                file: focus.file,
                                start: (_b = (_a = focus.token) === null || _a === void 0 ? void 0 : _a.start) !== null && _b !== void 0 ? _b : 0,
                                end: (_d = (_c = focus.token) === null || _c === void 0 ? void 0 : _c.end) !== null && _d !== void 0 ? _d : 0,
                            },
                            {
                                file: filePath,
                                start: (_f = (_e = otherFocus.token) === null || _e === void 0 ? void 0 : _e.start) !== null && _f !== void 0 ? _f : 0,
                                end: (_h = (_g = otherFocus.token) === null || _g === void 0 ? void 0 : _g.end) !== null && _h !== void 0 ? _h : 0,
                            },
                        ]
                    });
                }
                focuses[key] = focus;
                updateConditionExprsByFocus(focus, conditionExprs);
                hasChanged = true;
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