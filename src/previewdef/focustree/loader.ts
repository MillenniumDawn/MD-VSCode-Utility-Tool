import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { convertFocusFileNodeToJson, extractOrListIds, FocusTree, getFocusTreeWithFocusFile } from "./schema";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import uniq from "lodash/uniq";
import flatten from "lodash/flatten";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { getFlags } from "../../util/featureflags";
import { findFileByFocusKey } from "../../util/sharedFocusIndex";
import { focusTitlebarStylesFile, nationalFocusViewGfxFile, goalsOverlaysGfxFile } from "./titlebar";
import { GuiFileLoader } from "../gui/loader";
import { buildFocusTreeLayout, FocusTreeLayout, FocusTreeLayoutMode, nationalFocusViewGuiFile } from "./layout";
import { addInlayGfxWarnings, listGuiGfxFiles, loadFocusInlayWindows, resolveInlayGfxFiles, resolveInlayGuiWindows, resolveInlaysForTree } from "./inlay";

export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
    // Only set when the focusTreeLayout setting is `gui`; the preview uses the standard layout otherwise.
    layout?: FocusTreeLayout;
}

export type ProgressCallback = (message: string, current?: number, total?: number) => void;

const focusesGFX = 'interface/goals.gfx';

export class FocusTreeLoader extends ContentLoader<FocusTreeLoaderResult> {
    private progressListener: ProgressCallback | undefined;
    // The layout setting the last load was made with. The setting is not part of the document, so
    // without this a flip would be answered from the load cached for the unchanged text.
    private loadedLayoutMode: FocusTreeLayoutMode | undefined;

    public override async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
        if (this.loadedLayoutMode !== undefined && this.loadedLayoutMode !== getFlags().focusTreeLayout) {
            return true;
        }
        return super.shouldReloadImpl(session);
    }

    public setProgressListener(cb: ProgressCallback | undefined): void {
        this.progressListener = cb;
    }

    private emitProgress(message: string, current?: number, total?: number): void {
        this.progressListener?.(message, current, total);
    }

    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: unknown, session: LoaderSession): Promise<LoadResultOD<FocusTreeLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }

        const constants = {};

        this.emitProgress(localize('focustree.loading.parsing', 'Parsing focus file'));
        const file = convertFocusFileNodeToJson(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)), constants);

        if (getFlags().sharedFocusIndex) {
            const depPaths = new Set(dependencies.map(d => d.path));
            for (const focusTree of file.focus_tree) {
                for (const sharedFocus of extractOrListIds(focusTree.shared_focus)) {
                    const filePath = await findFileByFocusKey(sharedFocus);
                    if (filePath && !depPaths.has(filePath)) {
                        depPaths.add(filePath);
                        dependencies.push({type: 'focus', path: filePath});
                    }
                }
            }
        }

        const focusTreeDependencies = dependencies.filter(d => d.type === 'focus').map(d => d.path);
        if (focusTreeDependencies.length > 0) {
            this.emitProgress(localize('focustree.loading.shared', 'Loading shared focus dependencies'));
        }
        const focusTreeDepFiles = await this.loaderDependencies.loadMultiple(focusTreeDependencies, session, FocusTreeLoader);

        const importedFocusTrees = focusTreeDepFiles.flatMap(f => f.result.focusTrees);

        const focusTrees = getFocusTreeWithFocusFile(file, importedFocusTrees, this.file, constants);

        // Include synthetic trees from dependent files (e.g., joint focus trees)
        focusTrees.push(...importedFocusTrees.filter(tree => tree.isSharedFocues));

        // guiResolution.gfxFiles is exactly listGuiGfxFiles() and inlayGfxResolution.resolvedFiles is
        // [] when no tree has inlays, so the short-circuit still lists the interface gfx to keep the
        // icon-resolution gfx set (result.gfxFiles) byte-identical while skipping the inlay parse work.
        let inlayGuiGfxFiles: string[] = [];
        let inlayResolvedGfxFiles: string[] = [];
        let inlayGuiFiles: string[] = [];

        if (focusTrees.every(ft => ft.inlayWindowRefs.length === 0)) {
            for (const focusTree of focusTrees) {
                focusTree.inlayWindows = [];
                focusTree.inlayConditionExprs = [];
            }
            inlayGuiGfxFiles = await listGuiGfxFiles();
        } else {
            this.emitProgress(localize('focustree.loading.inlays', 'Loading inlay windows'));
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

            this.emitProgress(localize('focustree.loading.inlay_gui', 'Resolving inlay GUI files'));
            const guiResolution = await resolveInlayGuiWindows(focusTrees.flatMap(ft => ft.inlayWindows));
            for (const focusTree of focusTrees) {
                focusTree.warnings.push(...guiResolution.warnings.filter(w => focusTree.inlayWindows.some(inlay => inlay.id === w.source)));
            }

            this.emitProgress(localize('focustree.loading.inlay_gfx', 'Resolving inlay sprites'));
            const inlayGfxResolution = await resolveInlayGfxFiles(focusTrees.flatMap(ft => ft.inlayWindows));
            for (const focusTree of focusTrees) {
                addInlayGfxWarnings(focusTree.inlayWindows, focusTree.warnings);
            }

            inlayGuiGfxFiles = guiResolution.gfxFiles;
            inlayResolvedGfxFiles = inlayGfxResolution.resolvedFiles;
            inlayGuiFiles = guiResolution.guiFiles;
        }

        const gfxDependencies = [
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...flatten(focusTreeDepFiles.map(f => f.result.gfxFiles)),
            ...await getGfxContainerFiles(focusTrees.flatMap(ft => Object.values(ft.focuses)).flatMap(f => f.icon).map(i => i.icon)),
            ...inlayGuiGfxFiles,
            ...inlayResolvedGfxFiles,
        ];

        this.loadedLayoutMode = getFlags().focusTreeLayout;
        let layout: FocusTreeLayout | undefined = undefined;
        let layoutDependencies: string[] = [];
        if (getFlags().focusTreeLayout === 'gui') {
            // Loaded through the dependency loaders, so an edit to the gui reloads this tree.
            const layoutGui = await this.loaderDependencies.loadMultiple([nationalFocusViewGuiFile], session, GuiFileLoader);
            layout = buildFocusTreeLayout(layoutGui.flatMap(r => r.result.guiFiles).map(g => g.data));
            layoutDependencies = [nationalFocusViewGuiFile, ...mergeInLoadResult(layoutGui, 'dependencies')];
        }

        return {
            result: {
                focusTrees,
                gfxFiles: uniq([...gfxDependencies, focusesGFX]),
                layout,
            },
            dependencies: uniq([
                this.file,
                focusesGFX,
                focusTitlebarStylesFile,
                nationalFocusViewGfxFile,
                goalsOverlaysGfxFile,
                ...gfxDependencies,
                ...uniq(focusTrees.flatMap(ft => ft.inlayWindows).map(inlay => inlay.file)),
                ...inlayGuiFiles,
                ...focusTreeDependencies,
                ...mergeInLoadResult(focusTreeDepFiles, 'dependencies'),
                ...layoutDependencies,
            ]),
        };
    }

    public override toString() {
        return `[FocusTreeLoader ${this.file}]`;
    }
}
