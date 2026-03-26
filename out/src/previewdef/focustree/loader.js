"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FocusTreeLoader = void 0;
const tslib_1 = require("tslib");
const loader_1 = require("../../util/loader/loader");
const schema_1 = require("./schema");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const i18n_1 = require("../../util/i18n");
const lodash_1 = require("lodash");
const gfxindex_1 = require("../../util/gfxindex");
const featureflags_1 = require("../../util/featureflags");
const sharedFocusIndex_1 = require("../../util/sharedFocusIndex");
const titlebar_1 = require("./titlebar");
const inlay_1 = require("./inlay");
const focusesGFX = 'interface/goals.gfx';
class FocusTreeLoader extends loader_1.ContentLoader {
    postLoad(content, dependencies, error, session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (error || (content === undefined)) {
                throw error;
            }
            const constants = {};
            const file = (0, schema_1.convertFocusFileNodeToJson)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)), constants);
            if (featureflags_1.sharedFocusIndex) {
                for (const focusTree of file.focus_tree) {
                    for (const sharedFocus of focusTree.shared_focus) {
                        if (!sharedFocus) {
                            continue;
                        }
                        const filePath = (0, sharedFocusIndex_1.findFileByFocusKey)(sharedFocus);
                        if (filePath) {
                            if (dependencies.findIndex((item) => item.path === filePath) === -1) {
                                dependencies.push({ type: 'focus', path: filePath });
                            }
                        }
                    }
                }
            }
            const focusTreeDependencies = dependencies.filter(d => d.type === 'focus').map(d => d.path);
            const focusTreeDepFiles = yield this.loaderDependencies.loadMultiple(focusTreeDependencies, session, FocusTreeLoader);
            const importedFocusTrees = (0, lodash_1.chain)(focusTreeDepFiles)
                .flatMap(f => f.result.focusTrees)
                .value();
            const focusTrees = (0, schema_1.getFocusTreeWithFocusFile)(file, importedFocusTrees, this.file, constants);
            // Include synthetic trees from dependent files (e.g., joint focus trees)
            focusTrees.push(...importedFocusTrees.filter(tree => tree.isSharedFocues));
            const loadedInlays = yield (0, inlay_1.loadFocusInlayWindows)();
            for (const focusTree of focusTrees) {
                const resolved = (0, inlay_1.resolveInlaysForTree)(focusTree.inlayWindowRefs, loadedInlays.inlays);
                focusTree.inlayWindows = resolved.inlayWindows;
                focusTree.inlayConditionExprs = resolved.inlayConditionExprs;
                if (focusTree.inlayWindowRefs.length > 0) {
                    focusTree.warnings.push(...loadedInlays.warnings);
                }
                focusTree.warnings.push(...resolved.warnings);
            }
            const guiResolution = yield (0, inlay_1.resolveInlayGuiWindows)((0, lodash_1.chain)(focusTrees).flatMap(ft => ft.inlayWindows).value());
            for (const focusTree of focusTrees) {
                focusTree.warnings.push(...guiResolution.warnings.filter(w => focusTree.inlayWindows.some(inlay => inlay.id === w.source)));
            }
            const inlayGfxResolution = yield (0, inlay_1.resolveInlayGfxFiles)((0, lodash_1.chain)(focusTrees).flatMap(ft => ft.inlayWindows).value());
            for (const focusTree of focusTrees) {
                (0, inlay_1.addInlayGfxWarnings)(focusTree.inlayWindows, focusTree.warnings);
            }
            const gfxDependencies = [
                ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
                ...(0, lodash_1.flatten)(focusTreeDepFiles.map(f => f.result.gfxFiles)),
                ...yield (0, gfxindex_1.getGfxContainerFiles)((0, lodash_1.chain)(focusTrees).flatMap(ft => Object.values(ft.focuses)).flatMap(f => f.icon).map(i => i.icon).value()),
                ...guiResolution.gfxFiles,
                ...inlayGfxResolution.resolvedFiles,
            ];
            return {
                result: {
                    focusTrees,
                    gfxFiles: (0, lodash_1.uniq)([...gfxDependencies, focusesGFX]),
                },
                dependencies: (0, lodash_1.uniq)([
                    this.file,
                    focusesGFX,
                    titlebar_1.focusTitlebarStylesFile,
                    titlebar_1.nationalFocusViewGfxFile,
                    titlebar_1.goalsOverlaysGfxFile,
                    ...gfxDependencies,
                    ...(0, lodash_1.chain)(focusTrees).flatMap(ft => ft.inlayWindows).map(inlay => inlay.file).uniq().value(),
                    ...guiResolution.guiFiles,
                    ...focusTreeDependencies,
                    ...(0, loader_1.mergeInLoadResult)(focusTreeDepFiles, 'dependencies')
                ]),
            };
        });
    }
    toString() {
        return `[FocusTreeLoader ${this.file}]`;
    }
}
exports.FocusTreeLoader = FocusTreeLoader;
//# sourceMappingURL=loader.js.map