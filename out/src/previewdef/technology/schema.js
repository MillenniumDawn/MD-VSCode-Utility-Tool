"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTechnologyTrees = getTechnologyTrees;
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("../../util/common");
const technologySchema = {
    enable_equipments: "enum",
    path: {
        _innerType: {
            leads_to_tech: "string",
        },
        _type: "array",
    },
    folder: {
        _innerType: {
            name: "string",
            position: schema_1.positionSchema,
        },
        _type: "array",
    },
    start_year: "number",
    xor: "enum",
    sub_technologies: "enum",
};
const technologiesSchema = {
    _innerType: technologySchema,
    _type: "map",
};
const technologyFileSchema = {
    technologies: technologiesSchema,
};
function getTechnologyTrees(node) {
    const file = (0, schema_1.convertNodeToJson)(node, technologyFileSchema);
    const allTechnologies = getTechnologies(file.technologies._map);
    const result = [];
    const technologiesByFolder = getTechnologiesByFolder(allTechnologies);
    for (const [folder, techs] of Object.entries(technologiesByFolder)) {
        const trees = getTechnologiesByTree(techs);
        for (const [startTechnology, techs2] of Object.entries(trees)) {
            result.push({
                startTechnology: startTechnology,
                technologies: techs2,
                folder,
            });
        }
    }
    return result;
}
function getTechnologiesByFolder(allTechnologies) {
    const groupedTechnologies = {};
    for (const tech of Object.values(allTechnologies)) {
        for (const folder in tech.folders) {
            if (folder !== undefined && !(folder in groupedTechnologies)) {
                groupedTechnologies[folder] = [];
            }
            groupedTechnologies[folder].push(tech);
        }
    }
    return groupedTechnologies;
}
function getTechnologiesByTree(technologiesInOneFolder) {
    const techIdToTech = (0, common_1.arrayToMap)(technologiesInOneFolder, 'id');
    const trees = {};
    const treeRootMap = {};
    for (const technology of technologiesInOneFolder) {
        const treeRoot = treeRootMap[technology.id] ?? technology.id;
        const tree = trees[treeRoot] ?? [];
        tree.push(technology);
        for (const child of technology.leadsToTechs) {
            // the node is already in another tree
            if (treeRootMap[child] && treeRootMap[child] !== treeRoot) {
                continue;
            }
            if (!techIdToTech[child]) {
                continue;
            }
            treeRootMap[child] = treeRoot;
            tree.push(techIdToTech[child]);
            const childTree = trees[child];
            if (childTree) {
                for (const childTech of childTree) {
                    treeRootMap[childTech.id] = treeRoot;
                    tree.push(childTech);
                }
                delete trees[child];
            }
        }
        trees[treeRoot] = tree;
    }
    for (const rootTechId in trees) {
        trees[rootTechId].push(techIdToTech[rootTechId]);
    }
    return trees;
}
function getTechnologies(technologies) {
    const result = {};
    for (const { _key, _value } of Object.values(technologies)) {
        const id = _key;
        const technology = _value;
        const token = technology._token;
        const startYear = technology.start_year ?? 0;
        const leadsToTechs = technology.path.map(p => p.leads_to_tech).filter((p) => p !== undefined);
        const xor = technology.xor._values;
        const enableEquipments = technology.enable_equipments._values.length > 0;
        const folders = {};
        for (const folder of technology.folder) {
            const x = folder.position?.x?._value ?? 0;
            const y = folder.position?.y?._value ?? 0;
            const folderName = folder.name;
            if (folderName) {
                folders[folderName] = { name: folderName, x, y };
            }
        }
        result[id] = {
            id, token, startYear, leadsToTechs, xor, enableEquipments, folders,
            subTechnologies: [],
        };
    }
    for (const { _key, _value } of Object.values(technologies)) {
        const id = _key;
        const technology = _value;
        const techObject = result[id];
        for (const subTechnologyName of technology.sub_technologies._values) {
            const subTechnology = result[subTechnologyName];
            if (subTechnology) {
                techObject.subTechnologies.push(subTechnology);
            }
        }
    }
    return result;
}
//# sourceMappingURL=schema.js.map