"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuiFileLoader = void 0;
const lodash_1 = require("lodash");
const gui_1 = require("../../hoiformat/gui");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const schema_1 = require("../../hoiformat/schema");
const i18n_1 = require("../../util/i18n");
const loader_1 = require("../../util/loader/loader");
class GuiFileLoader extends loader_1.ContentLoader {
    async postLoad(content, dependencies, error, session) {
        if (error || (content === undefined)) {
            throw error;
        }
        const gfxDependencies = [this.file.replace(/.gui$/, '.gfx'), ...dependencies.filter(d => d.type === 'gfx').map(d => d.path)];
        const guiDependencies = dependencies.filter(d => d.type === 'gui').map(d => d.path);
        const guiDepFiles = await this.loaderDependencies.loadMultiple(guiDependencies, session, GuiFileLoader);
        const guiFile = (0, schema_1.convertNodeToJson)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)), gui_1.guiFileSchema);
        return {
            result: {
                gfxFiles: (0, lodash_1.chain)(gfxDependencies).concat((0, lodash_1.flatMap)(guiDepFiles, r => r.result.gfxFiles)).uniq().value(),
                guiFiles: (0, lodash_1.chain)(guiDepFiles).flatMap(r => r.result.guiFiles).concat({ file: this.file, data: guiFile }).uniq().value(),
            },
            dependencies: (0, lodash_1.chain)([this.file]).concat(gfxDependencies, (0, loader_1.mergeInLoadResult)(guiDepFiles, 'dependencies')).uniq().value(),
        };
    }
    toString() {
        return `[GuiFileLoader ${this.file}]`;
    }
}
exports.GuiFileLoader = GuiFileLoader;
//# sourceMappingURL=loader.js.map