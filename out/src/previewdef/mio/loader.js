"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MioLoader = void 0;
const loader_1 = require("../../util/loader/loader");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const i18n_1 = require("../../util/i18n");
const lodash_1 = require("lodash");
const schema_1 = require("./schema");
const gfxindex_1 = require("../../util/gfxindex");
const fileloader_1 = require("../../util/fileloader");
const schema_2 = require("../../hoiformat/schema");
const gui_1 = require("../../hoiformat/gui");
const mioGFX = 'interface/military_industrial_organization/industrial_organization_policies_and_traits_icons.gfx';
const ideaGFX = 'interface/ideas.gfx';
const mioOrgDir = 'common/military_industrial_organization/organizations';
const genericMio = `${mioOrgDir}/00_generic_organization.txt`;
const mioDetailGui = 'interface/military_industrial_organization/industrial_organization_detail.gui';
const mioFrameWindowName = 'industrial_organisation_tree_window';
const mioTreeHeaderName = 'tree_header';
const mioFlavorTextName = 'industrial_organisation_flavortext_window';
class MioLoader extends loader_1.ContentLoader {
    async postLoad(content, dependencies, error, session) {
        if (error || (content === undefined)) {
            throw error;
        }
        const originalMioDependencies = dependencies.filter(d => d.type === 'mio').map(d => d.path);
        const orgFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)(mioOrgDir))
            .filter(f => f.endsWith('.txt'))
            .map(f => `${mioOrgDir}/${f}`);
        const mioDependencies = (0, lodash_1.uniq)([...originalMioDependencies, genericMio, ...orgFiles])
            .filter(p => p !== this.file);
        const mioDepFiles = await this.loaderDependencies.loadMultiple(mioDependencies, session, MioLoader);
        const dependentMios = (0, lodash_1.flatMap)(mioDepFiles, m => m.result.mios);
        const mios = (0, schema_1.getMiosFromFile)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)), dependentMios, this.file);
        const gfxDependencies = [
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...(0, lodash_1.flatten)(mioDepFiles.map(f => f.result.gfxFiles)),
            ...await (0, gfxindex_1.getGfxContainerFiles)((0, lodash_1.chain)(mios).flatMap(m => Object.values(m.traits)).flatMap(t => t.icon).value()),
        ];
        const frame = await loadMioFrame();
        return {
            result: {
                mios,
                gfxFiles: (0, lodash_1.uniq)([...gfxDependencies, mioGFX, ideaGFX]),
                frame,
            },
            dependencies: (0, lodash_1.uniq)([
                this.file,
                mioGFX,
                ideaGFX,
                mioDetailGui,
                ...gfxDependencies,
                ...mioDependencies,
                ...(0, loader_1.mergeInLoadResult)(mioDepFiles, 'dependencies')
            ]),
        };
    }
    toString() {
        return `[MioLoader ${this.file}]`;
    }
}
exports.MioLoader = MioLoader;
async function loadMioFrame() {
    try {
        const [buffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(mioDetailGui);
        const guiNode = (0, hoiparser_1.parseHoi4File)(buffer.toString().replace(/^\uFEFF/, ""), (0, i18n_1.localize)('infile', 'In file {0}:\n', uri.toString()));
        const guiFile = (0, schema_2.convertNodeToJson)(guiNode, gui_1.guiFileSchema);
        const findByName = (roots, name) => {
            let result;
            const walk = (windows) => {
                for (const w of windows) {
                    if (!w)
                        continue;
                    if (w.name === name) {
                        result = w;
                        return;
                    }
                    if (w.containerwindowtype) {
                        walk(w.containerwindowtype);
                        if (result)
                            return;
                    }
                    if (w.windowtype) {
                        walk(w.windowtype);
                        if (result)
                            return;
                    }
                }
            };
            walk(roots);
            return result;
        };
        const topLevelWindows = [];
        for (const g of guiFile.guitypes) {
            if (!g)
                continue;
            if (g.containerwindowtype)
                topLevelWindows.push(...g.containerwindowtype);
            if (g.windowtype)
                topLevelWindows.push(...g.windowtype);
        }
        const found = findByName(topLevelWindows, mioFrameWindowName);
        if (!found) {
            return undefined;
        }
        const directChildren = [...(found.containerwindowtype ?? []), ...(found.windowtype ?? [])];
        const scrollbarWindow = directChildren.find(c => c?.name === 'scrollbar_window');
        const treeHeaderWindow = findByName([found], mioTreeHeaderName);
        const flavorTextWindow = (treeHeaderWindow ? findByName([treeHeaderWindow], mioFlavorTextName) : undefined)
            ?? findByName(topLevelWindows, mioFlavorTextName);
        return { window: found, scrollbarWindow, treeHeaderWindow, flavorTextWindow };
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=loader.js.map