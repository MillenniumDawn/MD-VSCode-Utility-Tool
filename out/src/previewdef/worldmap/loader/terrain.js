"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerrainFileLoader = exports.TerrainDefinitionLoader = void 0;
const common_1 = require("./common");
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const terrainFileSchema = {
    categories: {
        _innerType: {
            color: {
                _innerType: "enum",
                _type: "detailvalue",
            },
            naval_terrain: "boolean",
        },
        _type: "map",
    },
};
class TerrainDefinitionLoader extends common_1.FolderLoader {
    constructor() {
        super('common/terrain', TerrainFileLoader);
    }
    mergeFiles(fileResults, session) {
        const results = (0, common_1.mergeInLoadResult)(fileResults, 'result');
        const terrainMap = {};
        const warnings = (0, common_1.mergeInLoadResult)(fileResults, 'warnings');
        for (const terrain of results) {
            if (terrain.name in terrainMap) {
                warnings.push({
                    source: [],
                    text: (0, i18n_1.localize)('worldmap.warnings.terraindefinedtwice', 'Terrain {0} is defined in two files: {1}, {2}.', terrain.name, terrain.file, terrainMap[terrain.name].file),
                    relatedFiles: [terrain.file, terrainMap[terrain.name].file],
                });
            }
            else {
                terrainMap[terrain.name] = terrain;
            }
        }
        return Promise.resolve({
            result: Object.values(terrainMap),
            warnings,
            dependencies: [this.folder + '/*'],
        });
    }
    toString() {
        return `[TerrainDefinitionLoader]`;
    }
}
exports.TerrainDefinitionLoader = TerrainDefinitionLoader;
class TerrainFileLoader extends common_1.FileLoader {
    async loadFromFile() {
        return {
            result: await loadTerrains(this.file),
            warnings: [],
        };
    }
    toString() {
        return `[TerrainFileLoader ${this.file}]`;
    }
}
exports.TerrainFileLoader = TerrainFileLoader;
async function loadTerrains(file) {
    const data = await (0, fileloader_1.readFileFromModOrHOI4AsJson)(file, terrainFileSchema);
    return Object.values(data.categories._map).map(v => {
        const name = v._key;
        const color = (0, common_1.convertColor)(v._value.color);
        const isNaval = v._value.naval_terrain ?? false;
        return { name, color, isNaval, file };
    });
}
//# sourceMappingURL=terrain.js.map