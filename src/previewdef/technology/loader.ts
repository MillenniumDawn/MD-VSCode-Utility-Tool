import { TechnologyTree, getTechnologyTrees } from "./schema";
import { HOIPartial } from "../../hoiformat/schema";
import { GuiFile } from "../../hoiformat/gui";
import { ContentLoader, Dependency, LoadResultOD, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { flatMap, chain } from "lodash";
import { GuiFileLoader } from "../gui/loader";
import { listFilesFromModOrHOI4 } from "../../util/fileloader";
import { getConfiguration } from "../../util/vsccommon";

export interface TechnologyTreeLoaderResult {
    technologyTrees: TechnologyTree[];
    guiFiles: { file: string, data: HOIPartial<GuiFile> }[];
    gfxFiles: string[];
}

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

export class TechnologyTreeLoader extends ContentLoader<TechnologyTreeLoaderResult> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<TechnologyTreeLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }

        const gfxDependencies = [...relatedGfxFiles, ...dependencies.filter(d => d.type === 'gfx').map(d => d.path)];
        const technologyTrees = getTechnologyTrees(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)));
        const guiDependencies = [...guiFilePath, ...dependencies.filter(d => d.type === 'gui').map(d => d.path)];

        const configRoots = (getConfiguration().technologyGfxRoots ?? []).filter((r): r is string => !!r && r.trim() !== '');
        const extraGfxFiles: string[] = [];
        for (const root of configRoots) {
            try {
                const normalizedRoot = root.replace(/\\+/g, '/');
                const files = await listFilesFromModOrHOI4(normalizedRoot, { recursively: true });
                for (const file of files) {
                    if (file.toLowerCase().endsWith('.gfx')) {
                        extraGfxFiles.push(`${normalizedRoot}/${file}`.replace(/\/+/g, '/'));
                    }
                }
            } catch {
            }
        }

        const guiDepFiles = await this.loaderDependencies.loadMultiple(guiDependencies, session, GuiFileLoader);

        return {
            result: {
                technologyTrees,
                gfxFiles: chain(gfxDependencies).concat(extraGfxFiles, flatMap(guiDepFiles, r => r.result.gfxFiles)).uniq().value(),
                guiFiles: chain(guiDepFiles).flatMap(r => r.result.guiFiles).uniq().value(),
            },
            dependencies: chain([this.file]).concat(gfxDependencies, extraGfxFiles, guiDependencies, mergeInLoadResult(guiDepFiles, 'dependencies')).uniq().value(),
        };
    }

    public toString() {
        return `[TechnologyTreeLoader ${this.file}]`;
    }
}
