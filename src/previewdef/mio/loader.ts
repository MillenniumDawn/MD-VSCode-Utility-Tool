import { ContentLoader, LoadResultOD, Dependency, LoaderSession } from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import uniq from "lodash/uniq";
import { Mio, MioFileSource, getMiosFromFile } from "./schema";
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

// A discovery candidate is only parsed here. Recursing through MioLoader would manufacture
// A -> B -> A whenever two organization files share the same discovery folder.
class MioDefinitionsLoader extends ContentLoader<MioFileSource & { explicitDependencies: Dependency[] }> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: unknown): Promise<LoadResultOD<MioFileSource & { explicitDependencies: Dependency[] }>> {
        if (error || content === undefined) {
            throw error;
        }
        return {
            result: { node: parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)), filePath: this.file, explicitDependencies: dependencies },
            dependencies: [this.file],
        };
    }
}

export class MioLoader extends ContentLoader<MioLoaderResult> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: unknown, session: LoaderSession): Promise<LoadResultOD<MioLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }
        
        const orgFiles = (await listFilesFromModOrHOI4(mioOrgDir))
            .filter(f => f.toLowerCase().endsWith('.txt'))
            .map(f => `${mioOrgDir}/${f}`);
        const seen = new Set([this.file]);
        const mioDependencies: string[] = [];
        const sourceFiles: MioFileSource[] = [];
        const explicitDependencies = [...dependencies];
        const dependencyFiles = (explicit: Dependency[]) => uniq([
            ...explicit.filter(d => d.type === 'mio').map(d => d.path), genericMio, ...orgFiles,
        ]);
        const rootDependencies = dependencyFiles(dependencies);
        let pending = rootDependencies;
        while (pending.length > 0) {
            const batch = uniq(pending).filter(file => !seen.has(file));
            batch.forEach(file => seen.add(file));
            mioDependencies.push(...batch);
            session.throwIfCancelled();
            const loaded = await this.loaderDependencies.loadMultiple(batch, session, MioDefinitionsLoader);
            sourceFiles.push(...loaded.map(file => ({
                ...file.result,
                dependencies: dependencyFiles(file.result.explicitDependencies),
            })));
            const nextDependencies = loaded.flatMap(file => file.result.explicitDependencies);
            explicitDependencies.push(...nextDependencies);
            pending = nextDependencies.filter(d => d.type === 'mio').map(d => d.path);
        }

        const mios = getMiosFromFile(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file)), [], this.file, { files: sourceFiles, dependencies: rootDependencies });
        const gfxDependencies = [
            ...explicitDependencies.filter(d => d.type === 'gfx').map(d => d.path),
            ...await getGfxContainerFiles(mios.flatMap(m => Object.values(m.traits)).flatMap(t => t.icon)),
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
                `${mioOrgDir}/*`,
                ...mioDependencies
            ]),
        };
    }

    public override toString() {
        return `[MioLoader ${this.file}]`;
    }
}
