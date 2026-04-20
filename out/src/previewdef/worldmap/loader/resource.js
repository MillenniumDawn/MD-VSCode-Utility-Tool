"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceFileLoader = exports.ResourceDefinitionLoader = void 0;
const common_1 = require("./common");
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const imagecache_1 = require("../../../util/image/imagecache");
const resourceFileSchema = {
    resources: {
        _innerType: {
            icon_frame: "number",
        },
        _type: "map",
    },
};
const resourceGfxFile = 'interface/general_stuff.gfx';
class ResourceDefinitionLoader extends common_1.FolderLoader {
    constructor() {
        super('common/resources', ResourceFileLoader);
    }
    mergeFiles(fileResults, session) {
        const results = (0, common_1.mergeInLoadResult)(fileResults, 'result');
        const resourceMap = {};
        const warnings = (0, common_1.mergeInLoadResult)(fileResults, 'warnings');
        for (const resource of results) {
            if (resource.name in resourceMap) {
                warnings.push({
                    source: [],
                    text: (0, i18n_1.localize)('worldmap.warnings.resourcedefinedtwice', 'Resource {0} is defined in two files: {1}, {2}.', resource.name, resource.file, resourceMap[resource.name].file),
                    relatedFiles: [resource.file, resourceMap[resource.name].file],
                });
            }
            else {
                resourceMap[resource.name] = resource;
            }
        }
        return Promise.resolve({
            result: Object.values(resourceMap),
            warnings,
            dependencies: [this.folder + '/*'],
        });
    }
    toString() {
        return `[ResourceDefinitionLoader]`;
    }
}
exports.ResourceDefinitionLoader = ResourceDefinitionLoader;
class ResourceFileLoader extends common_1.FileLoader {
    async loadFromFile() {
        return {
            result: await loadResources(this.file),
            warnings: [],
            dependencies: [resourceGfxFile],
        };
    }
    toString() {
        return `[ResourceFileLoader ${this.file}]`;
    }
}
exports.ResourceFileLoader = ResourceFileLoader;
async function loadResources(file) {
    const data = await (0, fileloader_1.readFileFromModOrHOI4AsJson)(file, resourceFileSchema);
    const image = await (0, imagecache_1.getSpriteByGfxName)('GFX_resources_strip', resourceGfxFile);
    return Object.values(data.resources._map).map(v => {
        const name = v._key;
        const iconFrame = v._value.icon_frame ?? 0;
        const imageUri = image?.frames[iconFrame - 1]?.uri ?? image?.frames[0]?.uri ?? '';
        return { name, iconFrame, imageUri, file };
    });
}
//# sourceMappingURL=resource.js.map