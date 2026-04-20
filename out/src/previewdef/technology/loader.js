"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TechnologyTreeLoader = void 0;
const schema_1 = require("./schema");
const loader_1 = require("../../util/loader/loader");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const i18n_1 = require("../../util/i18n");
const lodash_1 = require("lodash");
const loader_2 = require("../gui/loader");
const fileloader_1 = require("../../util/fileloader");
const vsccommon_1 = require("../../util/vsccommon");
const technologyUIGfxFiles = [
    'interface/countrytechtreeview.gfx',
    'interface/countrytechnologyview.gfx',
];
const technologiesGFX = 'interface/technologies.gfx';
const relatedGfxFiles = [...technologyUIGfxFiles, technologiesGFX];
const guiFilePath = [
    'interface/countrytechtreeview.gui',
    'interface/countrydoctrinetreeview.gui',
];
class TechnologyTreeLoader extends loader_1.ContentLoader {
    async postLoad(content, dependencies, error, session) {
        if (error || (content === undefined)) {
            throw error;
        }
        const gfxDependencies = [...relatedGfxFiles, ...dependencies.filter(d => d.type === 'gfx').map(d => d.path)];
        const technologyTrees = (0, schema_1.getTechnologyTrees)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)));
        const guiDependencies = [...guiFilePath, ...dependencies.filter(d => d.type === 'gui').map(d => d.path)];
        const configRoots = ((0, vsccommon_1.getConfiguration)().technologyGfxRoots ?? []).filter((r) => !!r && r.trim() !== '');
        const extraGfxFiles = [];
        for (const root of configRoots) {
            try {
                const normalizedRoot = root.replace(/\\+/g, '/');
                const files = await (0, fileloader_1.listFilesFromModOrHOI4)(normalizedRoot, { recursively: true });
                for (const file of files) {
                    if (file.toLowerCase().endsWith('.gfx')) {
                        extraGfxFiles.push(`${normalizedRoot}/${file}`.replace(/\/+/g, '/'));
                    }
                }
            }
            catch {
            }
        }
        const guiDepFiles = await this.loaderDependencies.loadMultiple(guiDependencies, session, loader_2.GuiFileLoader);
        return {
            result: {
                technologyTrees,
                gfxFiles: (0, lodash_1.chain)(gfxDependencies).concat(extraGfxFiles, (0, lodash_1.flatMap)(guiDepFiles, r => r.result.gfxFiles)).uniq().value(),
                guiFiles: (0, lodash_1.chain)(guiDepFiles).flatMap(r => r.result.guiFiles).uniq().value(),
            },
            dependencies: (0, lodash_1.chain)([this.file]).concat(gfxDependencies, extraGfxFiles, guiDependencies, (0, loader_1.mergeInLoadResult)(guiDepFiles, 'dependencies')).uniq().value(),
        };
    }
    toString() {
        return `[TechnologyTreeLoader ${this.file}]`;
    }
}
exports.TechnologyTreeLoader = TechnologyTreeLoader;
//# sourceMappingURL=loader.js.map