"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MioLoader = void 0;
const tslib_1 = require("tslib");
const loader_1 = require("../../util/loader/loader");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const i18n_1 = require("../../util/i18n");
const lodash_1 = require("lodash");
const schema_1 = require("./schema");
const gfxindex_1 = require("../../util/gfxindex");
const mioGFX = 'interface/military_industrial_organization/industrial_organization_policies_and_traits_icons.gfx';
const ideaGFX = 'interface/ideas.gfx';
const genericMio = 'common/military_industrial_organization/organizations/00_generic_organization.txt';
class MioLoader extends loader_1.ContentLoader {
    postLoad(content, dependencies, error, session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (error || (content === undefined)) {
                throw error;
            }
            const originalMioDependencies = dependencies.filter(d => d.type === 'mio').map(d => d.path);
            const mioDependencies = this.file === genericMio ? originalMioDependencies : (0, lodash_1.uniq)([...originalMioDependencies, genericMio]);
            const mioDepFiles = yield this.loaderDependencies.loadMultiple(mioDependencies, session, MioLoader);
            const dependentMios = (0, lodash_1.flatMap)(mioDepFiles, m => m.result.mios);
            const mios = (0, schema_1.getMiosFromFile)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)), dependentMios, this.file);
            const gfxDependencies = [
                ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
                ...(0, lodash_1.flatten)(mioDepFiles.map(f => f.result.gfxFiles)),
                ...yield (0, gfxindex_1.getGfxContainerFiles)((0, lodash_1.chain)(mios).flatMap(m => Object.values(m.traits)).flatMap(t => t.icon).value()),
            ];
            return {
                result: {
                    mios,
                    gfxFiles: (0, lodash_1.uniq)([...gfxDependencies, mioGFX, ideaGFX]),
                },
                dependencies: (0, lodash_1.uniq)([
                    this.file,
                    mioGFX,
                    ideaGFX,
                    ...gfxDependencies,
                    ...mioDependencies,
                    ...(0, loader_1.mergeInLoadResult)(mioDepFiles, 'dependencies')
                ]),
            };
        });
    }
    toString() {
        return `[MioLoader ${this.file}]`;
    }
}
exports.MioLoader = MioLoader;
//# sourceMappingURL=loader.js.map