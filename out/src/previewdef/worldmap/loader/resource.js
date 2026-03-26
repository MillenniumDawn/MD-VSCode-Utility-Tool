"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceFileLoader = exports.ResourceDefinitionLoader = void 0;
const tslib_1 = require("tslib");
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
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return {
                result: yield loadResources(this.file),
                warnings: [],
                dependencies: [resourceGfxFile],
            };
        });
    }
    toString() {
        return `[ResourceFileLoader ${this.file}]`;
    }
}
exports.ResourceFileLoader = ResourceFileLoader;
function loadResources(file) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const data = yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(file, resourceFileSchema);
        const image = yield (0, imagecache_1.getSpriteByGfxName)('GFX_resources_strip', resourceGfxFile);
        return Object.values(data.resources._map).map(v => {
            var _a, _b, _c, _d, _e;
            const name = v._key;
            const iconFrame = (_a = v._value.icon_frame) !== null && _a !== void 0 ? _a : 0;
            const imageUri = (_e = (_c = (_b = image === null || image === void 0 ? void 0 : image.frames[iconFrame - 1]) === null || _b === void 0 ? void 0 : _b.uri) !== null && _c !== void 0 ? _c : (_d = image === null || image === void 0 ? void 0 : image.frames[0]) === null || _d === void 0 ? void 0 : _d.uri) !== null && _e !== void 0 ? _e : '';
            return { name, iconFrame, imageUri, file };
        });
    });
}
//# sourceMappingURL=resource.js.map