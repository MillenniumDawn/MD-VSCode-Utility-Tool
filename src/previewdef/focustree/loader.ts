import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { convertFocusFileNodeToJson, FocusTree, getFocusTreeWithFocusFile } from "./schema";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq, flatten, chain } from "lodash";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { sharedFocusIndex } from "../../util/featureflags";
import { findFileByFocusKey } from "../../util/sharedFocusIndex";
import { focusTitlebarStylesFile, nationalFocusViewGfxFile, goalsOverlaysGfxFile } from "./titlebar";
import { addInlayGfxWarnings, loadFocusInlayWindows, resolveInlayGfxFiles, resolveInlayGuiWindows, resolveInlaysForTree } from "./inlay";

export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
}

const focusesGFX = 'interface/goals.gfx';

export class FocusTreeLoader extends ContentLoader<FocusTreeLoaderResult> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<FocusTreeLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }

        const constants = {};

        const file = convertFocusFileNodeToJson(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)), constants);

        if (sharedFocusIndex) {
            const depPaths = new Set(dependencies.map(d => d.path));
            for (const focusTree of file.focus_tree) {
                for (const sharedFocus of focusTree.shared_focus) {
                    if (!sharedFocus) {
                        continue;
                    }
                    const filePath = findFileByFocusKey(sharedFocus);
                    if (filePath && !depPaths.has(filePath)) {
                        depPaths.add(filePath);
                        dependencies.push({type: 'focus', path: filePath});
                    }
                }
            }
        }

        const focusTreeDependencies = dependencies.filter(d => d.type === 'focus').map(d => d.path);
        const focusTreeDepFiles = await this.loaderDependencies.loadMultiple(focusTreeDependencies, session, FocusTreeLoader);

        const importedFocusTrees = chain(focusTreeDepFiles)
            .flatMap(f => f.result.focusTrees)
            .value();

        const focusTrees = getFocusTreeWithFocusFile(file, importedFocusTrees, this.file, constants);

        // Include synthetic trees from dependent files (e.g., joint focus trees)
        focusTrees.push(...importedFocusTrees.filter(tree => tree.isSharedFocues));

        const loadedInlays = await loadFocusInlayWindows();
        for (const focusTree of focusTrees) {
            const resolved = resolveInlaysForTree(focusTree.inlayWindowRefs, loadedInlays.inlays);
            focusTree.inlayWindows = resolved.inlayWindows;
            focusTree.inlayConditionExprs = resolved.inlayConditionExprs;
            if (focusTree.inlayWindowRefs.length > 0) {
                focusTree.warnings.push(...loadedInlays.warnings);
            }
            focusTree.warnings.push(...resolved.warnings);
        }

        const guiResolution = await resolveInlayGuiWindows(chain(focusTrees).flatMap(ft => ft.inlayWindows).value());
        for (const focusTree of focusTrees) {
            focusTree.warnings.push(...guiResolution.warnings.filter(w => focusTree.inlayWindows.some(inlay => inlay.id === w.source)));
        }

        const inlayGfxResolution = await resolveInlayGfxFiles(chain(focusTrees).flatMap(ft => ft.inlayWindows).value());
        for (const focusTree of focusTrees) {
            addInlayGfxWarnings(focusTree.inlayWindows, focusTree.warnings);
        }

        const gfxDependencies = [
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...flatten(focusTreeDepFiles.map(f => f.result.gfxFiles)),
            ...await getGfxContainerFiles(chain(focusTrees).flatMap(ft => Object.values(ft.focuses)).flatMap(f => f.icon).map(i => i.icon).value()),
            ...guiResolution.gfxFiles,
            ...inlayGfxResolution.resolvedFiles,
        ];

        return {
            result: {
                focusTrees,
                gfxFiles: uniq([...gfxDependencies, focusesGFX]),
            },
            dependencies: uniq([
                this.file,
                focusesGFX,
                focusTitlebarStylesFile,
                nationalFocusViewGfxFile,
                goalsOverlaysGfxFile,
                ...gfxDependencies,
                ...chain(focusTrees).flatMap(ft => ft.inlayWindows).map(inlay => inlay.file).uniq().value(),
                ...guiResolution.guiFiles,
                ...focusTreeDependencies,
                ...mergeInLoadResult(focusTreeDepFiles, 'dependencies')
            ]),
        };
    }

    public toString() {
        return `[FocusTreeLoader ${this.file}]`;
    }
}
