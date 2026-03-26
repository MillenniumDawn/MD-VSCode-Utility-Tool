// This file contains constants that may be used in package.json

export const ConfigurationKey = 'mdHoi4Utilities';
export const Hoi4FsSchema = 'hoi4installpath';

export namespace ViewType {
    export const DDS = 'mdhoi4utilities.dds';
    export const TGA = 'mdhoi4utilities.tga';
}

export namespace ContextName {
    export const ShouldHideHoi4Preview = 'shouldHideMdHoi4Preview';
    export const ShouldShowHoi4Preview = 'shouldShowMdHoi4Preview';
    export const Hoi4PreviewType = 'mdHoi4PreviewType';
    export const Hoi4MUInDev = 'mdHoi4MUInDev';
    export const Hoi4MULoaded = 'mdHoi4MULoaded';
}

export namespace Commands {
    export const Preview = 'mdhoi4utilities.preview';
    export const PreviewWorld = 'mdhoi4utilities.previewworld';
    export const ScanReferences = 'mdhoi4utilities.scanreferences';
    export const SelectModFile = 'mdhoi4utilities.selectmodfile';
    export const SelectHoiFolder = 'mdhoi4utilities.selecthoifolder';
    export const Test = 'mdhoi4utilities.test';
}

export namespace WebviewType {
    export const Preview = 'mdftpreview';
    export const PreviewWorldMap = 'mdworldmappreview';
}
