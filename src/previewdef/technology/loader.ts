import { TechnologyTree, getTechnologyTrees } from "./schema";
import { EquipmentArchetype, getEquipmentArchetypes } from "./equipmentschema";
import { HOIPartial } from "../../hoiformat/schema";
import { GuiFile } from "../../hoiformat/gui";
import { ContentLoader, Dependency, LoadResultOD, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { flatMap, chain } from "lodash";
import { GuiFileLoader } from "../gui/loader";
import { listFilesFromModOrHOI4, readFileFromModOrHOI4 } from "../../util/fileloader";
import { getConfiguration } from "../../util/vsccommon";
import { localisationIndex } from "../../util/featureflags";
import { debug } from "../../util/debug";
import { PromiseCache } from "../../util/cache";

export interface TechnologyTreeLoaderResult {
    technologyTrees: TechnologyTree[];
    guiFiles: { file: string, data: HOIPartial<GuiFile> }[];
    gfxFiles: string[];
    equipmentArchetypes: Record<string, EquipmentArchetype>;
}

const equipmentFolder = 'common/units/equipment';

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

        const { equipmentArchetypes, equipmentFiles } = await loadEquipmentArchetypes();

        return {
            result: {
                technologyTrees,
                gfxFiles: chain(gfxDependencies).concat(extraGfxFiles, flatMap(guiDepFiles, r => r.result.gfxFiles)).uniq().value(),
                guiFiles: chain(guiDepFiles).flatMap(r => r.result.guiFiles).uniq().value(),
                equipmentArchetypes,
            },
            dependencies: chain([this.file]).concat(gfxDependencies, extraGfxFiles, guiDependencies, equipmentFiles, mergeInLoadResult(guiDepFiles, 'dependencies')).uniq().value(),
        };
    }

    public toString() {
        return `[TechnologyTreeLoader ${this.file}]`;
    }
}

interface EquipmentArchetypesResult {
    equipmentArchetypes: Record<string, EquipmentArchetype>;
    equipmentFiles: string[];
}

// A single tech-tree preview renders many technologies, and a workspace can hold many tech-tree
// files; without caching, every render would re-walk and re-parse all `common/units/equipment`
// files. A short TTL collapses those repeated parses while staying fresh enough that edits show up
// within a couple of seconds, mirroring `fileListCache` in fileloader.ts.
const equipmentArchetypeCache = new PromiseCache<EquipmentArchetypesResult>({
    factory: () => loadEquipmentArchetypesUncached(),
    life: 3 * 1000,
    maxSize: 1,
});

// Returns the parsed equipment files so they can be registered as preview dependencies (edits refresh).
function loadEquipmentArchetypes(): Promise<EquipmentArchetypesResult> {
    return equipmentArchetypeCache.get('');
}

// Parses every `common/units/equipment/*.txt` file (mod + base game) into a single
// id -> archetype map so the renderer can resolve equipment short names. Skipped when the
// localisation index is off, since without it all name modes fall back to the raw id anyway.
async function loadEquipmentArchetypesUncached(): Promise<EquipmentArchetypesResult> {
    if (!localisationIndex) {
        return { equipmentArchetypes: {}, equipmentFiles: [] };
    }

    const relativeFiles = chain(await listFilesFromModOrHOI4(equipmentFolder, { recursively: true }))
        .filter(f => f.toLowerCase().endsWith('.txt'))
        .map(f => `${equipmentFolder}/${f}`.replace(/\/+/g, '/'))
        .uniq()
        .value();

    const fileArchetypes = await Promise.all(relativeFiles.map(async file => {
        try {
            const [buffer, realPath] = await readFileFromModOrHOI4(file);
            return getEquipmentArchetypes(parseHoi4File(buffer.toString(), localize('infile', 'In file {0}:\n', realPath)));
        } catch (e) {
            debug('Failed to parse equipment file ' + file, e);
            return {};
        }
    }));

    return { equipmentArchetypes: Object.assign({}, ...fileArchetypes), equipmentFiles: relativeFiles };
}
