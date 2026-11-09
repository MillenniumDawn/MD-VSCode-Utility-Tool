import { CustomMap, SchemaDef } from "../../../hoiformat/schema";
import { FileLoader, FolderLoader, LoadResultOD, mergeByNameWithDuplicateWarning, mergeInLoadResult } from "./common";
import { MapLoaderExtra, Resource } from "../definitions";
import { hoiFilesExpiryToken, readFileFromModOrHOI4AsJson } from "../../../util/fileloader";
import { LoadResult, LoaderSession } from '../../../util/loader/loader';
import { localize } from '../../../util/i18n';
import { getFlags } from "../../../util/featureflags";
import { getGfxContainerFile } from "../../../util/gfxindex";
import { getGfxSpriteMap, getSpriteByGfxName } from "../../../util/image/imagecache";
import uniq from "lodash/uniq";

interface ResourceFile {
    resources: CustomMap<ResourceDef>
}

interface ResourceDef {
    icon_frame: number;
}

const resourceFileSchema: SchemaDef<ResourceFile> = {
    resources: {
        _innerType: {
            icon_frame: "number",
        },
        _type: "map",
    },
};

const resourceSpriteName = 'GFX_resources_strip';
const resourceGfxFile = 'interface/general_stuff.gfx';

export class ResourceDefinitionLoader extends FolderLoader<Resource[], Resource[]> {
    constructor() {
        super('common/resources', ResourceFileLoader);
    }

    protected mergeLoadedFiles(fileResults: LoadResult<Resource[], MapLoaderExtra>[], _session: LoaderSession): Promise<LoadResult<Resource[], MapLoaderExtra>> {
        const { result: resourceMap, warnings } = mergeByNameWithDuplicateWarning(fileResults, 'first', (resource, existingResource) => ({
            source: [],
            text: localize('worldmap.warnings.resourcedefinedtwice', 'Resource {0} is defined in two files: {1}, {2}.',
                resource.name, resource.file, existingResource.file),
            relatedFiles: [resource.file, existingResource.file],
        }));

        return Promise.resolve({
            result: Object.values(resourceMap),
            warnings,
            dependencies: [
                this.folder + '/*',
                ...uniq(mergeInLoadResult(fileResults, "dependencies")),
            ],
        });
    }

    public override toString() {
        return `[ResourceDefinitionLoader]`;
    }
}

async function resourceSpriteSources(): Promise<string[]> {
    const indexed = await getGfxContainerFile(resourceSpriteName);
    const container = indexed ?? (getFlags().gfxIndex ? undefined : resourceGfxFile);
    if (container === undefined) {
        return [];
    }
    const texture = (await getGfxSpriteMap(container))[resourceSpriteName]?.texturefile;
    return texture === undefined ? [container] : [container, texture];
}

class ResourceFileLoader extends FileLoader<Resource[]> {
    private spriteSourcesToken: string = "";

    public override async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
        if (await super.shouldReloadImpl(session)) {
            return true;
        }
        return (await hoiFilesExpiryToken(await resourceSpriteSources())) !== this.spriteSourcesToken;
    }

    protected async loadFromFile(): Promise<LoadResultOD<Resource[]>> {
        const sources = await resourceSpriteSources();
        // Snapshot before reading so an edit during the load remains retryable.
        this.spriteSourcesToken = await hoiFilesExpiryToken(sources);
        return {
            result: await loadResources(this.file),
            warnings: [],
            dependencies: sources,
        };
    }

    public override toString() {
        return `[ResourceFileLoader ${this.file}]`;
    }
}

async function loadResources(file: string): Promise<Resource[]> {
    const data = await readFileFromModOrHOI4AsJson<ResourceFile>(file, resourceFileSchema);
    const image = await getSpriteByGfxName(resourceSpriteName, resourceGfxFile);
    return Object.values(data.resources._map).map<Resource>(v => {
        const name = v._key;
        const iconFrame = v._value.icon_frame ?? 0;
        const imageUri = image?.frame(iconFrame - 1)?.uri ?? image?.frame(0)?.uri ?? '';
        return { name, iconFrame, imageUri, file };
    });
}
