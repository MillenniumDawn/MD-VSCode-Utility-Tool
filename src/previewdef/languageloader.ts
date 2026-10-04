import { ContentLoader, Dependency, LoadResultOD, LoaderSession } from "../util/loader/loader";
import { getLanguageIdInYml } from "../util/vsccommon";

export abstract class LanguageAwareContentLoader<T> extends ContentLoader<T> {
	protected languageKey = "";

	public override async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		return (await super.shouldReloadImpl(session)) || this.languageKey !== getLanguageIdInYml();
	}

	protected async postLoad(content: string | undefined, dependencies: Dependency[], error: unknown, session: LoaderSession): Promise<LoadResultOD<T>> {
		if (error || content === undefined) {
			throw error;
		}
		this.languageKey = getLanguageIdInYml();
		return this.loadContent(content, dependencies, session);
	}

	protected abstract loadContent(content: string, dependencies: Dependency[], session: LoaderSession): Promise<LoadResultOD<T>>;
}
