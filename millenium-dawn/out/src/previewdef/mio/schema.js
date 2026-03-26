"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMiosFromFile = void 0;
const condition_1 = require("../../hoiformat/condition");
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("../../util/common");
const i18n_1 = require("../../util/i18n");
const mioTraitSchema = {
    token: "string",
    name: "string",
    icon: "string",
    any_parent: "enum",
    all_parents: "enum",
    parent: {
        traits: "enum",
        num_parents_needed: "number",
    },
    mutually_exclusive: "enum",
    position: {
        x: "number",
        y: "number",
    },
    relative_position_id: "string",
    visible: "raw",
    special_trait_background: "boolean",
    equipment_bonus: "raw",
    production_bonus: "raw",
    organization_modifier: "raw",
};
const mioSchema = {
    include: "string",
    trait: {
        _innerType: mioTraitSchema,
        _type: "array",
    },
    add_trait: {
        _innerType: mioTraitSchema,
        _type: "array",
    },
    override_trait: {
        _innerType: mioTraitSchema,
        _type: "array",
    },
    remove_trait: "enum",
};
const mioFileSchema = {
    _innerType: mioSchema,
    _type: "map",
};
function getMiosFromFile(node, dependentMios, filePath) {
    const file = (0, schema_1.convertNodeToJson)(node, mioFileSchema);
    const dependencies = [...dependentMios];
    const result = [];
    for (const key in file._map) {
        const mio = getMio(file._map[key], dependencies, filePath);
        dependencies.push(mio);
        if (!file._map[key]._value.include) {
            result.push(mio);
        }
    }
    // Run twice in case dependent mio is in current file.
    for (const key in file._map) {
        if (file._map[key]._value.include) {
            const mio = getMio(file._map[key], dependencies, filePath);
            result.push(mio);
        }
    }
    return result;
}
exports.getMiosFromFile = getMiosFromFile;
function getMio(mioDefItem, dependentMios, filePath) {
    const id = mioDefItem._key;
    const mioDef = mioDefItem._value;
    const baseMio = mioDef.include ? dependentMios.find(m => m.id === mioDef.include) : undefined;
    const traits = (baseMio === null || baseMio === void 0 ? void 0 : baseMio.traits) ? Object.assign({}, baseMio.traits) : {};
    const conditionExprs = (baseMio === null || baseMio === void 0 ? void 0 : baseMio.conditionExprs) ? [...baseMio.conditionExprs] : [];
    const warnings = [];
    if (mioDef.include && mioDef.trait.length > 0) {
        warnings.push({
            source: id,
            text: (0, i18n_1.localize)('miopreview.warnings.traitAndIncludeCheck1', 'Military industrial organization {0} has include property. It should use add_trait, remove_trait or override_trait instead of trait.', id),
        });
    }
    if (!mioDef.include && (mioDef.add_trait.length > 0 || mioDef.override_trait.length > 0 || mioDef.remove_trait._values.length > 0)) {
        warnings.push({
            source: id,
            text: (0, i18n_1.localize)('miopreview.warnings.traitAndIncludeCheck2', 'Military industrial organization {0} doesn\'t have include property. It should use trait instead of add_trait, remove_trait or override_trait.', id),
        });
    }
    for (const traitDef of [...mioDef.trait, ...mioDef.add_trait]) {
        const trait = getTrait(traitDef, filePath, warnings, conditionExprs);
        if (traits[trait.id]) {
            warnings.push({
                source: id,
                text: (0, i18n_1.localize)('miopreview.warnings.traitConflict', 'There\'re more than one trait with ID {0} in military industrial organization {1} in files: {2}, {3}.', trait.id, id, traits[trait.id].file, filePath),
            });
        }
        traits[trait.id] = trait;
    }
    for (const traitDef of mioDef.override_trait) {
        overrideTrait(traitDef, traits, filePath, warnings, conditionExprs);
    }
    for (const traitId of mioDef.remove_trait._values) {
        if (traitId && traits[traitId]) {
            traits[traitId] = Object.assign(Object.assign({}, traits[traitId]), { hasVisible: true, visible: false });
        }
    }
    validateRelativePositionId(traits, warnings);
    return {
        id,
        traits,
        conditionExprs,
        warnings,
    };
}
function validateRelativePositionId(traits, warnings) {
    const relativePositionId = {};
    const relativePositionIdChain = [];
    const circularReported = {};
    for (const trait of Object.values(traits)) {
        if (trait.relativePositionId === undefined) {
            continue;
        }
        if (!(trait.relativePositionId in traits)) {
            warnings.push({
                text: (0, i18n_1.localize)('miopreview.warnings.relativepositionidnotexist', 'Relative position ID of trait {0} not exist: {1}.', trait.id, trait.relativePositionId),
                source: trait.id,
            });
            continue;
        }
        relativePositionIdChain.length = 0;
        relativePositionId[trait.id] = traits[trait.relativePositionId];
        let currentTrait = trait;
        while (currentTrait) {
            if (circularReported[currentTrait.id]) {
                break;
            }
            relativePositionIdChain.push(currentTrait.id);
            const nextFocus = relativePositionId[currentTrait.id];
            if (nextFocus && relativePositionIdChain.includes(nextFocus.id)) {
                relativePositionIdChain.forEach(r => circularReported[r] = true);
                relativePositionIdChain.push(nextFocus.id);
                warnings.push({
                    text: (0, i18n_1.localize)('miopreview.warnings.relativepositioncircularref', "There're circular reference in relative position ID of these traits: {0}.", relativePositionIdChain.join(' -> ')),
                    source: trait.id,
                });
                break;
            }
            currentTrait = nextFocus;
        }
    }
}
function getTrait(traitDef, filePath, warnings, conditionExprs) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const id = (_a = traitDef.token) !== null && _a !== void 0 ? _a : `[missing_token_${(0, common_1.randomString)(8)}]`;
    if (!traitDef.token) {
        warnings.push({
            text: (0, i18n_1.localize)('miopreview.warnings.traitnoid', "A trait defined in this file don't have token property: {0}.", filePath),
            source: id,
        });
    }
    const x = (_c = (_b = traitDef.position) === null || _b === void 0 ? void 0 : _b.x) !== null && _c !== void 0 ? _c : 0;
    const y = (_e = (_d = traitDef.position) === null || _d === void 0 ? void 0 : _d.y) !== null && _e !== void 0 ? _e : 0;
    const name = (_f = traitDef.name) !== null && _f !== void 0 ? _f : '';
    const parent = traitDef.parent && traitDef.parent.traits._values.length > 0 ? {
        traits: traitDef.parent.traits._values,
        numNeeded: (_g = traitDef.parent.num_parents_needed) !== null && _g !== void 0 ? _g : 1,
    } : undefined;
    const visible = traitDef.visible ? (0, condition_1.extractConditionValue)(traitDef.visible._raw.value, { scopeName: '', scopeType: 'mio' }, conditionExprs).condition : true;
    const effects = [];
    if ((_h = traitDef.equipment_bonus) === null || _h === void 0 ? void 0 : _h._raw.value) {
        effects.push('equiment');
    }
    if ((_j = traitDef.production_bonus) === null || _j === void 0 ? void 0 : _j._raw.value) {
        effects.push('production');
    }
    if ((_k = traitDef.organization_modifier) === null || _k === void 0 ? void 0 : _k._raw.value) {
        effects.push('organization');
    }
    return {
        id,
        name,
        icon: traitDef.icon,
        x,
        y,
        anyParent: traitDef.any_parent._values,
        allParents: traitDef.all_parents._values,
        parent,
        exclusive: traitDef.mutually_exclusive._values,
        relativePositionId: traitDef.relative_position_id,
        visible,
        hasVisible: traitDef.visible !== undefined,
        specialTraitBackground: (_l = traitDef.special_trait_background) !== null && _l !== void 0 ? _l : false,
        effects,
        token: traitDef._token,
        file: filePath,
    };
}
function overrideTrait(traitDef, traits, filePath, warnings, conditionExprs) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const id = traitDef.token;
    if (!id) {
        warnings.push({
            text: (0, i18n_1.localize)('miopreview.warnings.overridetraitnoid', "An override_trait defined in this file don't have token property: {0}.", filePath),
            source: `unknown`,
        });
        return;
    }
    const trait = traits[id];
    if (!trait) {
        warnings.push({
            text: (0, i18n_1.localize)('miopreview.warnings.overridetraitidnotexist', "An override_trait referenced a trait that doesn't exist: {0}.", id),
            source: id,
        });
        return;
    }
    trait.name = (_a = traitDef.name) !== null && _a !== void 0 ? _a : trait.name;
    trait.icon = (_b = traitDef.icon) !== null && _b !== void 0 ? _b : trait.icon;
    trait.x = (_d = (_c = traitDef.position) === null || _c === void 0 ? void 0 : _c.x) !== null && _d !== void 0 ? _d : trait.x;
    trait.y = (_f = (_e = traitDef.position) === null || _e === void 0 ? void 0 : _e.y) !== null && _f !== void 0 ? _f : trait.y;
    trait.anyParent = traitDef.any_parent._values.length > 0 ? traitDef.any_parent._values : trait.anyParent;
    trait.allParents = traitDef.all_parents._values.length > 0 ? traitDef.all_parents._values : trait.allParents;
    trait.parent = traitDef.parent && traitDef.parent.traits._values.length > 0 ? {
        traits: traitDef.parent.traits._values,
        numNeeded: (_g = traitDef.parent.num_parents_needed) !== null && _g !== void 0 ? _g : 1,
    } : trait.parent;
    trait.exclusive = traitDef.mutually_exclusive._values.length > 0 ? traitDef.mutually_exclusive._values : trait.exclusive;
    trait.relativePositionId = (_h = traitDef.relative_position_id) !== null && _h !== void 0 ? _h : trait.relativePositionId;
    trait.specialTraitBackground = (_j = traitDef.special_trait_background) !== null && _j !== void 0 ? _j : trait.specialTraitBackground;
    trait.visible = traitDef.visible ?
        (0, condition_1.extractConditionValue)(traitDef.visible._raw.value, { scopeName: '', scopeType: 'mio' }, conditionExprs).condition :
        trait.visible;
    trait.hasVisible = traitDef.visible !== undefined || trait.hasVisible;
    if (traitDef._token) {
        trait.token = traitDef._token;
        trait.file = filePath;
    }
}
//# sourceMappingURL=schema.js.map