import { HOIBopFile, getBopsFromFile } from "./schema";
import {
	ContentLoader,
	Dependency,
	LoadResultOD,
	LoaderSession,
} from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import uniq from "lodash/uniq";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { getLanguageIdInYml } from "../../util/vsccommon";
import {
	ModifierDefinitions,
	listModifierDefinitionFiles,
	loadModifierDefinitions,
} from "../../util/modifiers";

export interface BopLoaderResult {
	bops: HOIBopFile;
	gfxFiles: string[];
	modifierDefinitions: ModifierDefinitions;
}

// Where the game defines its own side icons. Pinned so an icon still resolves with the gfx index
// off, when the index cannot say which file a sprite lives in.
const bopGfxFile = "interface/powerbalanceview.gfx";

export class BopLoader extends ContentLoader<BopLoaderResult> {
	private languageKey: string = "";

	public override async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		return (
			(await super.shouldReloadImpl(session)) ||
			this.languageKey !== getLanguageIdInYml()
		);
	}

	protected async postLoad(
		content: string | undefined,
		dependencies: Dependency[],
		error: unknown,
		_session: LoaderSession,
	): Promise<LoadResultOD<BopLoaderResult>> {
		if (error || content === undefined) {
			throw error;
		}

		this.languageKey = getLanguageIdInYml();

		const bops = getBopsFromFile(
			parseHoi4File(content, localize("infile", "In file {0}:\n", this.file)),
			this.file,
		);

		const icons = bops.bops.flatMap((b) => b.sides).map((s) => s.icon);
		const [modifierDefinitions, definitionFiles, gfxContainers] = await Promise.all([
			loadModifierDefinitions(),
			listModifierDefinitionFiles(),
			getGfxContainerFiles(uniq(icons)),
		]);

		const gfxFiles = uniq([
			...dependencies.filter((d) => d.type === "gfx").map((d) => d.path),
			...gfxContainers,
			bopGfxFile,
		]);

		return {
			result: { bops, gfxFiles, modifierDefinitions },
			// The .gfx files the icons come from and the modifier definitions the ranges are worded
			// with. Reporting them subscribes the preview to them; renderBopFile then forces the
			// session on a dependency change, since this file's own hash has not moved.
			dependencies: uniq([this.file, ...gfxFiles, ...definitionFiles]),
		};
	}

	public override toString() {
		return `[BopLoader ${this.file}]`;
	}
}
