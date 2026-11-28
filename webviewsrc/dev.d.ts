declare var previewedFileUri: string | undefined;
declare function acquireVsCodeApi(): VSCodeAPI;

interface Window {
    characterPreview?: import('../src/previewdef/character/payload').CharacterPreviewPayload;
    decisionGraph?: import('../src/previewdef/decision/payload').DecisionGraphPayload;
    eventGraph?: import('../src/previewdef/event/payload').EventGraphPayload;
    ideaPreview?: import('../src/previewdef/idea/payload').IdeaPreviewPayload;
}

declare interface VSCodeAPI {
    setState<T>(state: T): void;
    getState<T>(): T | undefined;
    postMessage<T>(message: T): void;
}

interface NodeRequire {
    context(directory: string, useSubdirectories?: boolean, regExp?: RegExp, mode?: string): NodeRequire;
}
