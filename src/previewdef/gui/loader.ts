import uniq from "lodash/uniq";
import { GuiFile, guiFileSchema } from "../../hoiformat/gui";
import { parseHoi4File, resolveScriptVariables } from "../../hoiformat/hoiparser";
import { convertNodeToJson, HOIPartial } from "../../hoiformat/schema";
import { getFilePathFromModOrHOI4 } from "../../util/fileloader";
import { localize } from "../../util/i18n";
import { ContentLoader, Dependency, LoaderSession, LoadResultOD, mergeInLoadResult } from "../../util/loader/loader";

export interface GuiFileLoaderResult {
    guiFiles: { file: string, data: HOIPartial<GuiFile> }[];
    gfxFiles: string[];
}

export class GuiFileLoader extends ContentLoader<GuiFileLoaderResult> {
    protected async postLoad(content: string | undefined, dependencies: Dependency[], error: unknown, session: LoaderSession): Promise<LoadResultOD<GuiFileLoaderResult>> {
        if (error || (content === undefined)) {
            throw error;
        }

        const companion = this.file.replace(/\.gui$/, '.gfx');
        const gfxDependencies = dependencies.filter(d => d.type === 'gfx').map(d => d.path);
        if (await getFilePathFromModOrHOI4(companion)) {
            gfxDependencies.unshift(companion);
        }
        const guiDependencies = dependencies.filter(d => d.type === 'gui').map(d => d.path);

        const guiDepFiles = await this.loaderDependencies.loadMultiple(guiDependencies, session, GuiFileLoader);

        const guiFile = convertNodeToJson<GuiFile>(resolveScriptVariables(parseHoi4File(content, localize('infile', 'In file {0}:\n', this.file))), guiFileSchema);

        return {
            result: {
                gfxFiles: uniq([...gfxDependencies, ...guiDepFiles.flatMap(r => r.result.gfxFiles)]),
                guiFiles: uniq([...guiDepFiles.flatMap(r => r.result.guiFiles), { file: this.file, data: guiFile }]),
            },
            dependencies: uniq([this.file, companion, ...gfxDependencies, ...mergeInLoadResult(guiDepFiles, 'dependencies')]),
        };
    }

    public override toString() {
        return `[GuiFileLoader ${this.file}]`;
    }
}
