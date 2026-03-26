import { HOIEvents } from "./schema";
import { ContentLoader, Dependency, LoadResultOD, LoaderSession } from "../../util/loader/loader";
export interface EventsLoaderResult {
    events: HOIEvents;
    mainNamespaces: string[];
    gfxFiles: string[];
    localizationDict: Record<string, string>;
}
export declare class EventsLoader extends ContentLoader<EventsLoaderResult> {
    private languageKey;
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<EventsLoaderResult>>;
    toString(): string;
}
