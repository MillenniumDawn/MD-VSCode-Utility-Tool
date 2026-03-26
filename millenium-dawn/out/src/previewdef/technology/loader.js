"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TechnologyTreeLoader = void 0;
const tslib_1 = require("tslib");
const schema_1 = require("./schema");
const loader_1 = require("../../util/loader/loader");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const i18n_1 = require("../../util/i18n");
const lodash_1 = require("lodash");
const loader_2 = require("../gui/loader");
const technologyUIGfxFiles = ['interface/countrytechtreeview.gfx', 'interface/countrytechnologyview.gfx'];
const technologiesGFX = 'interface/technologies.gfx';
const relatedGfxFiles = [...technologyUIGfxFiles, technologiesGFX];
const guiFilePath = ['interface/countrytechtreeview.gui', 'interface/countrydoctrinetreeview.gui'];
class TechnologyTreeLoader extends loader_1.ContentLoader {
    postLoad(content, dependencies, error, session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (error || (content === undefined)) {
                throw error;
            }
            const gfxDependencies = [...relatedGfxFiles, ...dependencies.filter(d => d.type === 'gfx').map(d => d.path)];
            const technologyTrees = (0, schema_1.getTechnologyTrees)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)));
            const guiDependencies = [...guiFilePath, ...dependencies.filter(d => d.type === 'gui').map(d => d.path)];
            const guiDepFiles = yield this.loaderDependencies.loadMultiple(guiDependencies, session, loader_2.GuiFileLoader);
            return {
                result: {
                    technologyTrees,
                    gfxFiles: (0, lodash_1.chain)(gfxDependencies).concat((0, lodash_1.flatMap)(guiDepFiles, r => r.result.gfxFiles)).uniq().value(),
                    guiFiles: (0, lodash_1.chain)(guiDepFiles).flatMap(r => r.result.guiFiles).uniq().value(),
                },
                dependencies: (0, lodash_1.chain)([this.file]).concat(gfxDependencies, guiDependencies, (0, loader_1.mergeInLoadResult)(guiDepFiles, 'dependencies')).uniq().value(),
            };
        });
    }
    toString() {
        return `[TechnologyTreeLoader ${this.file}]`;
    }
}
exports.TechnologyTreeLoader = TechnologyTreeLoader;
//# sourceMappingURL=loader.js.map