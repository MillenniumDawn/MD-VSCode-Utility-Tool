import { ConditionComplexExpr, ConditionItem, extractConditionValue } from "../../hoiformat/condition";
import { Node, Token } from "../../hoiformat/hoiparser";
import { CustomMap, Enum, HOIPartial, Raw, SchemaDef, convertNodeToJson, emptyMap } from "../../hoiformat/schema";
import { Warning, randomString } from "../../util/common";
import { localize } from "../../util/i18n";

export interface Mio {
    id: string;
    traits: Record<string, MioTrait>;
    textHeaders: MioTextHeader[];
    conditionExprs: ConditionItem[];
    warnings: MioWarning[];
}

interface MioTextHeader {
    text: string;
    x: number;
}

interface MioWarning extends Warning<string> {
    navigations?: { file: string, start: number, end: number }[];
    // The other traits a warning is about, which the preview marks along with the source.
    relatedSources?: string[];
}

export type TraitEffect = 'equiment' | 'production' | 'organization';

export interface MioTrait {
    id: string;
    name: string;
    icon: string | undefined;
    anyParent: string[];
    allParents: string[];
    exclusive: string[];
    parent: {
        traits: string[];
        numNeeded: number;
    } | undefined;
    x: number;
    y: number;
    relativePositionId: string | undefined;
    visible: ConditionComplexExpr;
    hasVisible: boolean;
    specialTraitBackground: boolean;
    effects: TraitEffect[];
    token: Token | undefined;
    file: string;
    sourceMioId: string;
}

interface MioDef {
    include: string;
    trait: MioTraitDef[];
    add_trait: MioTraitDef[];
    override_trait: MioTraitDef[];
    remove_trait: Enum;
    tree_header_text: MioTreeHeaderDef[];
}

interface MioTreeHeaderDef {
    text: string;
    x: number;
}

interface MioTraitDef {
    token: string;
    name: string;
    icon: string;
    any_parent: Enum;
    all_parents: Enum;
    parent: {
        traits: Enum;
        num_parents_needed: number;
    };
    mutually_exclusive: Enum;
    position: {
        x: number;
        y: number;
    };
    relative_position_id: string;
    special_trait_background: boolean;
    visible: Raw;
    equipment_bonus: Raw;
    production_bonus: Raw;
    organization_modifier: Raw;
    _token: Token;
}

type MioFile = CustomMap<MioDef>;

const mioTraitSchema: SchemaDef<MioTraitDef> = {
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

const mioTreeHeaderSchema: SchemaDef<MioTreeHeaderDef> = {
    text: "string",
    x: "number",
};

const mioSchema: SchemaDef<MioDef> = {
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
    tree_header_text: {
        _innerType: mioTreeHeaderSchema,
        _type: "array",
    },
};

const mioFileSchema: SchemaDef<MioFile> = {
    _innerType: mioSchema,
    _type: "map",
};

export function getMiosFromFile(node: Node, dependentMios: Mio[], filePath: string): Mio[] {
    const file = convertNodeToJson<MioFile>(node, mioFileSchema);
    const dependencies: Mio[] = [...dependentMios];
    const result: Mio[] = [];

    for (const key in file._map) {
        const mioDefItem = file._map[key];
        if (!mioDefItem) {
            continue;
        }
        const mio = getMio(mioDefItem, dependencies, filePath);
        dependencies.push(mio);
        if (!mioDefItem._value.include) {
            result.push(mio);
        }
    }

    // Run twice in case dependent mio is in current file.
    for (const key in file._map) {
        const mioDefItem = file._map[key];
        if (mioDefItem?._value.include) {
            const mio = getMio(mioDefItem, dependencies, filePath);
            result.push(mio);
        }
    }

    return result;
}

function getMio(mioDefItem: { _key: string, _value: HOIPartial<MioDef> }, dependentMios: Mio[], filePath: string): Mio {
    const id = mioDefItem._key;
    const mioDef = mioDefItem._value;
    const baseMio = mioDef.include ? dependentMios.find(m => m.id === mioDef.include) : undefined;
    // Keyed by the trait token the file wrote, so the map has no prototype for a token like
    // __proto__ or constructor to land on.
    const traits: Record<string, MioTrait> = Object.assign(emptyMap<MioTrait>(), baseMio?.traits);
    const textHeaders: MioTextHeader[] = baseMio?.textHeaders ? [...baseMio.textHeaders] : [];
    const conditionExprs = baseMio?.conditionExprs ? [...baseMio.conditionExprs] : [];
    const warnings: MioWarning[] = [];

    for (const headerDef of mioDef.tree_header_text) {
        if (headerDef.text === undefined) {
            continue;
        }
        textHeaders.push({ text: headerDef.text, x: headerDef.x ?? 0 });
    }

    if (mioDef.include && mioDef.trait.length > 0) {
        warnings.push({
            source: id,
            text: localize('miopreview.warnings.traitAndIncludeCheck1', 'Military industrial organization {0} has include property. It should use add_trait, remove_trait or override_trait instead of trait.', id),
        });
    }

    if (!mioDef.include && (mioDef.add_trait.length > 0 || mioDef.override_trait.length > 0 || mioDef.remove_trait._values.length > 0)) {
        warnings.push({
            source: id,
            text: localize('miopreview.warnings.traitAndIncludeCheck2', 'Military industrial organization {0} doesn\'t have include property. It should use trait instead of add_trait, remove_trait or override_trait.', id),
        });
    }

    for (const traitDef of [...mioDef.trait, ...mioDef.add_trait]) {
        const trait = getTrait(traitDef, filePath, warnings, conditionExprs);
        trait.sourceMioId = id;
        const existingTrait = traits[trait.id];
        if (existingTrait) {
            warnings.push({
                source: id,
                text: localize('miopreview.warnings.traitConflict', 'There\'re more than one trait with ID {0} in military industrial organization {1} in files: {2}, {3}.', trait.id, id, existingTrait.file, filePath),
            });
        }
        traits[trait.id] = trait;
    }

    for (const traitDef of mioDef.override_trait) {
        overrideTrait(traitDef, traits, filePath, warnings, conditionExprs, id);
    }

    for (const traitId of mioDef.remove_trait._values) {
        if (traitId && traits[traitId]) {
            traits[traitId] = {
                ...traits[traitId],
                hasVisible: true,
                visible: false,
            };
        }
    }

    validateRelativePositionId(traits, warnings);
    validateTraitLinks(traits, id, warnings);

    return {
        id,
        traits,
        textHeaders,
        conditionExprs,
        warnings,
    };
}

function validateRelativePositionId(traits: Record<string, MioTrait>, warnings: MioWarning[]) {
    const relativePositionId: Record<string, MioTrait | undefined> = emptyMap();
    const relativePositionIdChain: string[] = [];
    const circularReported: Record<string, boolean> = emptyMap();

    for (const trait of Object.values(traits)) {
        if (trait.relativePositionId === undefined) {
            continue;
        }

        if (!(trait.relativePositionId in traits)) {
            warnings.push({
                text: localize('miopreview.warnings.relativepositionidnotexist', 'Relative position ID of trait {0} not exist: {1}.', trait.id, trait.relativePositionId),
                source: trait.id,
            });
            continue;
        }

        relativePositionIdChain.length = 0;
        relativePositionId[trait.id] = traits[trait.relativePositionId];
        let currentTrait: MioTrait | undefined = trait;
        while (currentTrait) {
            if (circularReported[currentTrait.id]) {
                break;
            }

            relativePositionIdChain.push(currentTrait.id);
            const nextFocus: MioTrait | undefined = relativePositionId[currentTrait.id];
            if (nextFocus && relativePositionIdChain.includes(nextFocus.id)) {
                relativePositionIdChain.forEach(r => circularReported[r] = true);
                relativePositionIdChain.push(nextFocus.id);
                warnings.push({
                    text: localize('miopreview.warnings.relativepositioncircularref', "There're circular reference in relative position ID of these traits: {0}.", relativePositionIdChain.join(' -> ')),
                    source: trait.id,
                });
                break;
            }
            currentTrait = nextFocus;
        }
    }
}

// Resolves where a trait is drawn, following relative_position_id the way the preview does. A
// circular chain is cut the way the preview cuts it: the trait reached a second time counts as 0,0
// and is not cached, so the trait the chain started from keeps its own offset. The cycle itself is
// validateRelativePositionId's to report.
function resolveTraitPosition(
    trait: MioTrait | undefined,
    traits: Record<string, MioTrait>,
    cache: Map<string, { x: number, y: number }>,
    stack: Set<string> = new Set(),
): { x: number, y: number } {
    if (trait === undefined) {
        return { x: 0, y: 0 };
    }

    const cached = cache.get(trait.id);
    if (cached) {
        return cached;
    }

    if (stack.has(trait.id)) {
        return { x: 0, y: 0 };
    }

    const position = { x: trait.x, y: trait.y };
    if (trait.relativePositionId !== undefined) {
        stack.add(trait.id);
        const relativePosition = resolveTraitPosition(traits[trait.relativePositionId], traits, cache, stack);
        stack.delete(trait.id);
        position.x += relativePosition.x;
        position.y += relativePosition.y;
    }

    cache.set(trait.id, position);
    return position;
}

// Whether this organization decides where a trait is drawn: it defines or overrides the trait, or
// any trait its relative_position_id chain hangs from. An inherited trait anchored to an overridden
// one moves with it, so its links are this organization's to check as much as its own traits' are.
function placedBy(trait: MioTrait, traits: Record<string, MioTrait>, mioId: string): boolean {
    const seen = new Set<string>();
    for (let current: MioTrait | undefined = trait; current && !seen.has(current.id);
        current = current.relativePositionId !== undefined ? traits[current.relativePositionId] : undefined) {
        if (current.sourceMioId === mioId) {
            return true;
        }
        seen.add(current.id);
    }
    return false;
}

function isRemoved(trait: MioTrait): boolean {
    return trait.hasVisible && trait.visible === false;
}

// The parent and mutually exclusive links of every trait: links to traits that do not exist, a
// parent that is not above the trait it unlocks, a parent block that asks for more parents than it
// lists, and exclusive alternatives that are not side by side. A link between two traits inherited
// unchanged from the included organization, both still drawn where it put them, is that
// organization's to report, so a derived one only checks the links its own traits take part in and
// the ones it moved by overriding an anchor.
function validateTraitLinks(traits: Record<string, MioTrait>, mioId: string, warnings: MioWarning[]) {
    // Resolved up front in the order the preview draws them, which decides where a circular chain
    // is cut.
    const positions = new Map<string, { x: number, y: number }>();
    for (const trait of Object.values(traits)) {
        resolveTraitPosition(trait, traits, positions);
    }
    const yOf = (trait: MioTrait) => resolveTraitPosition(trait, traits, positions).y;
    const checked = (trait: MioTrait) => placedBy(trait, traits, mioId);
    const reportedPairs = new Set<string>();

    for (const trait of Object.values(traits)) {
        if (isRemoved(trait)) {
            continue;
        }

        const ownTrait = trait.sourceMioId === mioId;
        const y = yOf(trait);
        const parentGroups: { parents: string[], numNeeded: number }[] = [
            ...trait.allParents.map(p => ({ parents: [p], numNeeded: 1 })),
            ...(trait.anyParent.length > 0 ? [{ parents: trait.anyParent, numNeeded: 1 }] : []),
            ...(trait.parent ? [{ parents: trait.parent.traits, numNeeded: trait.parent.numNeeded }] : []),
        ];

        for (const parentId of [...trait.allParents, ...trait.anyParent, ...(trait.parent?.traits ?? [])]) {
            if (ownTrait && !(parentId in traits)) {
                warnings.push({
                    text: localize('miopreview.warnings.parentnotexist', 'Parent {0} of trait {1} does not exist.', parentId, trait.id),
                    source: trait.id,
                });
            }
        }

        if (ownTrait && trait.parent && trait.parent.numNeeded > trait.parent.traits.length) {
            warnings.push({
                text: localize('miopreview.warnings.numparentsneeded', 'Trait {0} needs {1} parents but lists only {2}, so it can never be unlocked.', trait.id, trait.parent.numNeeded, trait.parent.traits.length),
                source: trait.id,
            });
        }

        for (const group of parentGroups) {
            const known = group.parents
                .filter(p => p !== trait.id)
                .map(p => traits[p])
                .filter((p): p is MioTrait => p !== undefined);
            if (known.length === 0 || !(checked(trait) || known.some(checked))) {
                continue;
            }
            const notAbove = known.filter(p => yOf(p) >= y).map(p => p.id);
            const above = known.length - notAbove.length;
            if (notAbove.length > 0 && above < Math.min(group.numNeeded, known.length)) {
                warnings.push({
                    text: localize('miopreview.warnings.parentnotabove', 'Parent {0} of trait {1} is not positioned above it.', notAbove.join(', '), trait.id),
                    source: trait.id,
                    relatedSources: notAbove,
                });
            }
        }

        for (const exclusiveId of trait.exclusive) {
            if (exclusiveId === trait.id) {
                continue;
            }
            const exclusive = traits[exclusiveId];
            if (!exclusive) {
                if (ownTrait) {
                    warnings.push({
                        text: localize('miopreview.warnings.exclusivenotexist', 'Mutually exclusive trait {0} of trait {1} does not exist.', exclusiveId, trait.id),
                        source: trait.id,
                    });
                }
                continue;
            }
            const key = trait.id < exclusiveId ? `${trait.id}\u0001${exclusiveId}` : `${exclusiveId}\u0001${trait.id}`;
            if (reportedPairs.has(key) || isRemoved(exclusive) || !(checked(trait) || checked(exclusive))) {
                continue;
            }
            reportedPairs.add(key);
            if (yOf(exclusive) !== y) {
                warnings.push({
                    text: localize('miopreview.warnings.exclusivenotsamey', 'Mutually exclusive traits {0} and {1} are not on the same row.', trait.id, exclusiveId),
                    source: trait.id,
                    relatedSources: [exclusiveId],
                });
            }
        }
    }
}

function getTrait(traitDef: HOIPartial<MioTraitDef>, filePath: string, warnings: MioWarning[], conditionExprs: ConditionItem[]): MioTrait {
    const id = traitDef.token ?? `[missing_token_${randomString(8)}]`;

    if (!traitDef.token) {
        warnings.push({
            text: localize('miopreview.warnings.traitnoid', "A trait defined in this file don't have token property: {0}.", filePath),
            source: id,
        });
    }

    const x = traitDef.position?.x ?? 0;
    const y = traitDef.position?.y ?? 0;
    const name = traitDef.name ?? '';
    const parent = traitDef.parent && traitDef.parent.traits._values.length > 0 ? {
        traits: traitDef.parent.traits._values,
        numNeeded: traitDef.parent.num_parents_needed ?? 1,
    } : undefined;

    const visible = traitDef.visible ? extractConditionValue(traitDef.visible._raw.value, { scopeName: '', scopeType: 'mio' }, conditionExprs).condition : true;
    const effects: TraitEffect[] = [];
    if (traitDef.equipment_bonus?._raw.value) {
        effects.push('equiment');
    }
    if (traitDef.production_bonus?._raw.value) {
        effects.push('production');
    }
    if (traitDef.organization_modifier?._raw.value) {
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
        specialTraitBackground: traitDef.special_trait_background ?? false,
        effects,
        token: traitDef._token,
        file: filePath,
        sourceMioId: '',
    };
}

function overrideTrait(traitDef: HOIPartial<MioTraitDef>, traits: Record<string, MioTrait>, filePath: string, warnings: MioWarning[], conditionExprs: ConditionItem[], overridingMioId: string) {
    const id = traitDef.token;
    if (!id) {
        warnings.push({
            text: localize('miopreview.warnings.overridetraitnoid', "An override_trait defined in this file don't have token property: {0}.", filePath),
            source: `unknown`,
        });
        return;
    }

    const existing = traits[id];
    if (!existing) {
        warnings.push({
            text: localize('miopreview.warnings.overridetraitidnotexist', "An override_trait referenced a trait that doesn't exist: {0}.", id),
            source: id,
        });
        return;
    }

    // A copy: the map is a shallow copy of the included MIO's, so writing to the trait itself
    // would change it in that MIO as well.
    const trait: MioTrait = traits[id] = { ...existing };

    trait.name = traitDef.name ?? trait.name;
    trait.icon = traitDef.icon ?? trait.icon;
    trait.x = traitDef.position?.x ?? trait.x;
    trait.y = traitDef.position?.y ?? trait.y;
    trait.anyParent = traitDef.any_parent._values.length > 0 ? traitDef.any_parent._values : trait.anyParent;
    trait.allParents = traitDef.all_parents._values.length > 0 ? traitDef.all_parents._values : trait.allParents;
    trait.parent = traitDef.parent && traitDef.parent.traits._values.length > 0 ? {
        traits: traitDef.parent.traits._values,
        numNeeded: traitDef.parent.num_parents_needed ?? 1,
    } : trait.parent;
    trait.exclusive = traitDef.mutually_exclusive._values.length > 0 ? traitDef.mutually_exclusive._values : trait.exclusive;
    trait.relativePositionId = traitDef.relative_position_id ?? trait.relativePositionId;
    trait.specialTraitBackground = traitDef.special_trait_background ?? trait.specialTraitBackground;
    trait.visible = traitDef.visible ?
        extractConditionValue(traitDef.visible._raw.value, { scopeName: '', scopeType: 'mio' }, conditionExprs).condition :
        trait.visible;
    trait.hasVisible = traitDef.visible !== undefined || trait.hasVisible;
    if (traitDef._token) {
        trait.token = traitDef._token;
        trait.file = filePath;
    }
    trait.sourceMioId = overridingMioId;
}

