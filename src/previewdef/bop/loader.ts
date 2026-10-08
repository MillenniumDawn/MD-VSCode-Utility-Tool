import { HOIBopFile, getBopsFromFile } from "./schema";
import {
	Dependency,
	LoadResultOD,
	LoaderSession,
} from "../../util/loader/loader";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { localize } from "../../util/i18n";
import uniq from "lodash/uniq";
import { getGfxContainerFiles } from "../../util/gfxindex";
import { LanguageAwareContentLoader } from "../languageloader";
import { ResolvedGuiWindow, findContainerWindows } from "../../util/guiwindowindex";
import { parseAndResolveHoi4FileCached } from "../../util/fileloader";
import { ContainerWindowType, GuiFile, IconType, guiFileSchema } from "../../hoiformat/gui";
import { HOIPartial, convertNodeToJson } from "../../hoiformat/schema";
import { Logger } from "../../util/logger";
import { describeParseFailure } from "../../util/indexHalf";
import { HOIDecision } from "../decision/schema";
import { decisionSpriteName, getDecisionGfxFiles } from "../decision/loader";
import { decisionItemWindowName, decisionsFolder, loadCategoryDecisions } from "./decisions";

interface BopWindowTemplates {
	// The tick the game puts at every range boundary.
	rangeBar?: HOIPartial<IconType>;
	// The marker above a boundary, frame 1 lit for the active range.
	rangeIndicator?: HOIPartial<IconType>;
}

export interface BopLoaderResult {
	bops: HOIBopFile;
	gfxFiles: string[];
	// The game's balance of power window, from the mod or the game install.
	window?: ResolvedGuiWindow;
	templates: BopWindowTemplates;
	// The decisions of every `decision_category` the file names, keyed by category.
	decisions: Record<string, HOIDecision[]>;
	// The row the game draws each of those decisions with.
	decisionItem?: ResolvedGuiWindow;
}

export const bopWindowName = "powerbalanceview";

// The progress bar sprites the game swaps onto `power_balance_value`, which names none itself.
export const bopFillSprites = {
	left: "GFX_power_balance_left",
	right: "GFX_power_balance_right",
	leftMoving: "GFX_power_balance_left_moving",
	rightMoving: "GFX_power_balance_right_moving",
} as const;

// Where the game defines the window's own sprites. Pinned so they still resolve with the gfx index
// off, when the index cannot say which file a sprite lives in.
const bopGfxFile = "interface/powerbalanceview.gfx";

export class BopLoader extends LanguageAwareContentLoader<BopLoaderResult> {

	protected async loadContent(
		content: string,
		dependencies: Dependency[],
		_session: LoaderSession,
	): Promise<LoadResultOD<BopLoaderResult>> {
		const bops = getBopsFromFile(
			parseHoi4File(content, localize("infile", "In file {0}:\n", this.file)),
			this.file,
		);

		const categories = uniq(
			bops.bops.map((b) => b.decisionCategory).filter((c): c is string => c !== undefined),
		);
		const [windows, decisions, decisionGfxFiles] = await Promise.all([
			findContainerWindows(categories.length > 0 ? [bopWindowName, decisionItemWindowName] : [bopWindowName]),
			loadCategoryDecisions(categories),
			categories.length > 0 ? getDecisionGfxFiles() : Promise.resolve([]),
		]);
		const window = windows[bopWindowName];
		const decisionItem = categories.length > 0 ? windows[decisionItemWindowName] : undefined;
		const templates = window ? await loadTemplates(window.file) : {};

		const sprites = [
			...bops.bops.flatMap((b) => b.sides).map((s) => s.icon),
			...(window ? spritesOf(window.window) : []),
			...(decisionItem ? spritesOf(decisionItem.window) : []),
			...Object.values(decisions).flatMap((ds) =>
				ds.map((d) => (d.icons[0] ? decisionSpriteName(d.icons[0].key) : undefined)),
			),
			templates.rangeBar?.spritetype,
			templates.rangeIndicator?.spritetype,
			...Object.values(bopFillSprites),
		].filter((s): s is string => s !== undefined);
		const gfxContainers = await getGfxContainerFiles(uniq(sprites));

		const gfxFiles = uniq([
			...dependencies.filter((d) => d.type === "gfx").map((d) => d.path),
			...gfxContainers,
			...decisionGfxFiles,
			bopGfxFile,
		]);

		return {
			result: { bops, gfxFiles, window, templates, decisions, decisionItem },
			// The window's .gui and the .gfx files its sprites and the side icons come from, and the
			// decisions folder the listed decisions are read from. Reporting them subscribes the
			// preview to them; renderBopFile then forces the session on a dependency change, since
			// this file's own hash has not moved.
			dependencies: uniq([
				this.file,
				...(window ? [window.file] : []),
				...(decisionItem ? [decisionItem.file] : []),
				...(categories.length > 0 ? [`${decisionsFolder}/*`] : []),
				...gfxFiles,
			]),
		};
	}

	public override toString() {
		return `[BopLoader ${this.file}]`;
	}
}

// `range_bar` and `range_indicator` sit at the top of powerbalanceview.gui, outside any window: the
// game copies them onto the bar once per range, so they are read from the same file the window is.
async function loadTemplates(guiFile: string): Promise<BopWindowTemplates> {
	try {
		const gui = convertNodeToJson<GuiFile>(await parseAndResolveHoi4FileCached(guiFile), guiFileSchema);
		const icons = gui.guitypes.flatMap((t) => t.icontype);
		return {
			rangeBar: icons.find((i) => i.name === "range_bar"),
			rangeIndicator: icons.find((i) => i.name === "range_indicator"),
		};
	} catch (e) {
		Logger.error(`Cannot read the range templates in ${guiFile}: ${describeParseFailure(e)}`);
		return {};
	}
}

function spritesOf(window: HOIPartial<ContainerWindowType>): (string | undefined)[] {
	return [
		window.background?.spritetype,
		window.background?.quadtexturesprite,
		...window.icontype.flatMap((i) => [i.spritetype, i.quadtexturesprite]),
		...[...window.buttontype, ...window.checkboxtype, ...window.guibuttontype].flatMap((b) => [
			b.spritetype,
			b.quadtexturesprite,
		]),
		...[...window.containerwindowtype, ...window.windowtype].flatMap(spritesOf),
	];
}
