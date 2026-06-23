import { Node, Token } from "../../hoiformat/hoiparser";
import { CustomMap, SchemaDef, convertNodeToJson } from "../../hoiformat/schema";

export interface EquipmentArchetype {
    shortName?: string;
    archetype?: string;
}

type EquipmentsDef = CustomMap<EquipmentDef>;

interface EquipmentDef {
    short_name: string;
    archetype: string;
    is_archetype: boolean;
    _token: Token;
}

interface EquipmentFile {
    equipments: EquipmentsDef;
}

const equipmentDefSchema: SchemaDef<EquipmentDef> = {
    short_name: "string",
    archetype: "string",
    is_archetype: "boolean",
};

const equipmentFileSchema: SchemaDef<EquipmentFile> = {
    equipments: {
        _innerType: equipmentDefSchema,
        _type: "map",
    },
};

// Parses a `common/units/equipment/*.txt` file into a map of equipment id ->
// { shortName, archetype }. `short_name` is the localisation key HOI4 uses for the
// tech-tree display name; `archetype` lets a concrete equipment inherit its archetype's
// short name when it declares none of its own.
export function getEquipmentArchetypes(node: Node): Record<string, EquipmentArchetype> {
    const file = convertNodeToJson<EquipmentFile>(node, equipmentFileSchema);
    const result: Record<string, EquipmentArchetype> = {};

    for (const { _key, _value } of Object.values(file.equipments?._map ?? {})) {
        result[_key] = {
            shortName: _value.short_name,
            archetype: _value.archetype,
        };
    }

    return result;
}
