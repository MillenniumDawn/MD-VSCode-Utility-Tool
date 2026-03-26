"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTechnologyTrees = void 0;
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
exports.getTechnologyTrees = getTechnologyTrees;
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
    var _a, _b;
    const techIdToTech = (0, common_1.arrayToMap)(technologiesInOneFolder, 'id');
    const trees = {};
    const treeRootMap = {};
    for (const technology of technologiesInOneFolder) {
        const treeRoot = (_a = treeRootMap[technology.id]) !== null && _a !== void 0 ? _a : technology.id;
        const tree = (_b = trees[treeRoot]) !== null && _b !== void 0 ? _b : [];
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
    var _a, _b, _c, _d, _e, _f, _g;
    const result = {};
    for (const { _key, _value } of Object.values(technologies)) {
        const id = _key;
        const technology = _value;
        const token = technology._token;
        const startYear = (_a = technology.start_year) !== null && _a !== void 0 ? _a : 0;
        const leadsToTechs = technology.path.map(p => p.leads_to_tech).filter((p) => p !== undefined);
        const xor = technology.xor._values;
        const enableEquipments = technology.enable_equipments._values.length > 0;
        const folders = {};
        for (const folder of technology.folder) {
            const x = (_d = (_c = (_b = folder.position) === null || _b === void 0 ? void 0 : _b.x) === null || _c === void 0 ? void 0 : _c._value) !== null && _d !== void 0 ? _d : 0;
            const y = (_g = (_f = (_e = folder.position) === null || _e === void 0 ? void 0 : _e.y) === null || _f === void 0 ? void 0 : _f._value) !== null && _g !== void 0 ? _g : 0;
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