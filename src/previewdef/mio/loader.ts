import { ContentLoader, LoadResultOD, Dependency, LoaderSession, mergeInLoadResult } from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import { uniq, flatten, chain, flatMap } from "lodash";
import { Mio, getMiosFromFile } from "./schema";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { listFilesFromModOrHOI4 } from "../../util/fileloader";
import { nationalFocusViewGfxFile } from "../../util/hoi4gui/exclusivelinkimages";

export interface MioLoaderResult {
    mios: Mio[];
    gfxFiles: string[];
}

const mioGFX = 'interface/military_industrial_organization/industrial_organization_policies_and_traits_icons.gfx';
const ideaGFX = 'interface/ideas.gfx';
// The mutually exclusive link textures live here, not in the mio interface folder: the game's mio
// view reuses the focus view's sprites. Listed as a dependency so editing it refreshes the preview.
const exclusiveLinkGFX = nationalFocusViewGfxFile;
const mioOrgDir = 'common/military_industrial_organization/organizations';
const genericMio = `${mioOrgDir}/00_generic_organization.txt`;

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

        return {
            result: {
                mios,
                gfxFiles: uniq([...gfxDependencies, mioGFX, ideaGFX, exclusiveLinkGFX]),
            },
            dependencies: uniq([
                this.file,
                mioGFX,
                ideaGFX,
                exclusiveLinkGFX,
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
