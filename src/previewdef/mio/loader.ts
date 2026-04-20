import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq, flatten, chain, flatMap } from "lodash";
import { Mio, getMiosFromFile } from "./schema";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { readFileFromModOrHOI4, listFilesFromModOrHOI4 } from "../../util/fileloader";
import { convertNodeToJson, HOIPartial } from "../../hoiformat/schema";
import { ContainerWindowType, GuiFile, guiFileSchema } from "../../hoiformat/gui";

export interface MioFrame {
    window: HOIPartial<ContainerWindowType>;
    scrollbarWindow: HOIPartial<ContainerWindowType> | undefined;
}

export interface MioLoaderResult {
    mios: Mio[];
    gfxFiles: string[];
    frame: MioFrame | undefined;
}

const mioGFX = 'interface/military_industrial_organization/industrial_organization_policies_and_traits_icons.gfx';
const ideaGFX = 'interface/ideas.gfx';
const mioOrgDir = 'common/military_industrial_organization/organizations';
const genericMio = `${mioOrgDir}/00_generic_organization.txt`;
const mioDetailGui = 'interface/military_industrial_organization/industrial_organization_detail.gui';
const mioFrameWindowName = 'industrial_organisation_tree_window';

export class MioLoader extends ContentLoader<MioLoaderResult> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<MioLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }
        
        const originalMioDependencies = dependencies.filter(d => d.type === 'mio').map(d => d.path);
        const orgFiles = (await listFilesFromModOrHOI4(mioOrgDir))
            .filter(f => f.endsWith('.txt'))
            .map(f => `${mioOrgDir}/${f}`);
        const mioDependencies = uniq([ ...originalMioDependencies, genericMio, ...orgFiles ])
            .filter(p => p !== this.file);
        const mioDepFiles = await this.loaderDependencies.loadMultiple(mioDependencies, session, MioLoader);

        const dependentMios = flatMap(mioDepFiles, m => m.result.mios);
        const mios = getMiosFromFile(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)), dependentMios, this.file);

        const gfxDependencies = [
            ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...flatten(mioDepFiles.map(f => f.result.gfxFiles)),
            ...await getGfxContainerFiles(chain(mios).flatMap(m => Object.values(m.traits)).flatMap(t => t.icon).value()),
        ];

        const frame = await loadMioFrame();

        return {
            result: {
                mios,
                gfxFiles: uniq([...gfxDependencies, mioGFX, ideaGFX]),
                frame,
            },
            dependencies: uniq([
                this.file,
                mioGFX,
                ideaGFX,
                mioDetailGui,
                ...gfxDependencies,
                ...mioDependencies,
                ...mergeInLoadResult(mioDepFiles, 'dependencies')
            ]),
        };
    }

    public toString() {
        return `[MioLoader ${this.file}]`;
    }
}

async function loadMioFrame(): Promise<MioFrame | undefined> {
    try {
        const [buffer, uri] = await readFileFromModOrHOI4(mioDetailGui);
        const guiNode = parseHoi4File(buffer.toString().replace(/^\uFEFF/, ""), localize('infile', 'In file {0}:\n', uri.toString()));
        const guiFile = convertNodeToJson<GuiFile>(guiNode, guiFileSchema);

        const findByName = (roots: HOIPartial<ContainerWindowType>[], name: string): HOIPartial<ContainerWindowType> | undefined => {
            let result: HOIPartial<ContainerWindowType> | undefined;
            const walk = (windows: HOIPartial<ContainerWindowType>[]) => {
                for (const w of windows) {
                    if (!w) continue;
                    if (w.name === name) {
                        result = w;
                        return;
                    }
                    if (w.containerwindowtype) {
                        walk(w.containerwindowtype);
                        if (result) return;
                    }
                    if (w.windowtype) {
                        walk(w.windowtype);
                        if (result) return;
                    }
                }
            };
            walk(roots);
            return result;
        };

        const topLevelWindows: HOIPartial<ContainerWindowType>[] = [];
        for (const g of guiFile.guitypes) {
            if (!g) continue;
            if (g.containerwindowtype) topLevelWindows.push(...g.containerwindowtype);
            if (g.windowtype) topLevelWindows.push(...g.windowtype);
        }

        const found = findByName(topLevelWindows, mioFrameWindowName);
        if (!found) {
            return undefined;
        }

        const directChildren = [...(found.containerwindowtype ?? []), ...(found.windowtype ?? [])];
        const scrollbarWindow = directChildren.find(c => c?.name === 'scrollbar_window');

        return { window: found, scrollbarWindow };
    } catch {
        return undefined;
    }
}
