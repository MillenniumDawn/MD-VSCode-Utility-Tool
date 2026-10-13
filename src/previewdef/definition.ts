import type * as vscode from "vscode";
import { FeatureFlags, getFlags } from "../util/featureflags";
import { matchPathEnd } from "../util/nodecommon";
import type { PreviewBase } from "./previewbase";

// Every preview is the same thing at its root: a kind of file it recognises, and something to open
// for one. That root is here. What a preview's own folder adds is what it draws.

type BooleanFlag = { [K in keyof FeatureFlags]: FeatureFlags[K] extends boolean ? K : never }[keyof FeatureFlags];

export interface PreviewFiles {
	// The setting that turns the preview on. The previews that are always on leave it out.
	flag?: BooleanFlag;
	// In lower case, with the dot. A file with any other extension is turned down without being read.
	extension: string;
	// The last segments of the path of a file that is this preview's without a look inside it, `*`
	// standing for any name. Left out, the extension alone settles it.
	folder?: string[];
	// What a file kept somewhere else has to say to be taken all the same.
	content?: RegExp;
}

// In lower case: a path is lower-cased before it is compared.
export const previewFiles = {
	focustree: { extension: ".txt", folder: ["common", "national_focus", "*"] },
	gfx: { extension: ".gfx" },
	technology: { extension: ".txt", folder: ["common", "technologies", "*"], content: /(technologies)\s*=\s*{/ },
	worldmap: { extension: ".map", folder: ["map", "default.map"] },
	event: {
		flag: "eventTreePreview",
		extension: ".txt",
		folder: ["events", "*"],
		content: /(country_event|news_event|unit_leader_event|state_event|operative_leader_event)\s*=\s*{/,
	},
	gui: { extension: ".gui" },
	mio: { extension: ".txt", folder: ["common", "military_industrial_organization", "organizations", "*"] },
	// An ideas file kept somewhere else still previews, as long as it opens with the `ideas` block
	// the game reads. Anchored to the start of a line so a stray `swap_ideas = {` in a focus file
	// does not claim the preview.
	idea: { flag: "ideaPreview", extension: ".txt", folder: ["common", "ideas", "*"], content: /^\s*ideas\s*=\s*{/m },
	// `["common", "decisions", "*"]` matches the three trailing segments, so a file under
	// common/decisions/categories is not claimed here: the category definitions are a different
	// format and are read as a dependency of a decisions file rather than previewed on their own.
	//
	// Answering 0 for the folder also settles the overlap with the event preview. A decisions file
	// very often calls `country_event = { ... }` from a complete_effect, which is what the event
	// preview matches on, and it answers with the offset of that match -- always greater than zero.
	// The lowest number wins, so the decision preview does and the file no longer opens as an empty
	// event graph.
	decision: { flag: "decisionPreview", extension: ".txt", folder: ["common", "decisions", "*"] },
	// A characters file kept somewhere else still previews, as long as it opens with the
	// `characters` block the game reads. Anchored to the start of a line so a `characters = {`
	// nested inside an effect does not claim the preview.
	character: {
		flag: "characterPreview",
		extension: ".txt",
		folder: ["common", "characters", "*"],
		content: /^\s*characters\s*=\s*{/m,
	},
	// A BoP kept somewhere else still previews, as long as its first line inside the block is the
	// `initial_value` every balance of power opens with.
	bop: {
		flag: "bopPreview",
		extension: ".txt",
		folder: ["common", "bop", "*"],
		content: /^[ \t]*\w+[ \t]*=[ \t]*{\s*(?:#.*\s*)*initial_value\s*=/m,
	},
} satisfies Record<string, PreviewFiles>;

// How strongly a preview claims a document: 0 for a file that is its own by where it is, the
// offset of the match for one that is its own by what it says, nothing for any other. The lowest
// number among the previews wins.
export function matchPreviewFiles(files: PreviewFiles, document: vscode.TextDocument): number | undefined {
	if (files.flag !== undefined && !getFlags()[files.flag]) {
		return undefined;
	}

	const uri = document.uri;
	if (!uri.path.toLowerCase().endsWith(files.extension)) {
		return undefined;
	}

	if (files.folder === undefined || matchPathEnd(uri.toString().toLowerCase(), files.folder)) {
		return 0;
	}

	return files.content?.exec(document.getText())?.index;
}

export type PreviewProviderDef = PreviewProviderDefNormal | PreviewProviderDefAlternative;

interface PreviewProviderDefCommon {
	type: string;
	/**
	 * What the "can't preview this file" message calls this preview, naming the paths it
	 * recognises -- that is the half of the answer the reader can act on.
	 *
	 * A function rather than a string: these defs are module-level constants, and a localize()
	 * call at module load would freeze the English text in before extension.ts runs loadI18n().
	 */
	displayName(): string;
	/**
	 * False when the preview's feature-flag setting is off, so the message does not offer a type
	 * that would refuse the file anyway. Omitted by the previews that are always on.
	 */
	isEnabled?(): boolean;
	canPreview(document: vscode.TextDocument): number | undefined;
}

interface PreviewProviderDefNormal extends PreviewProviderDefCommon {
	previewConstructor: new (uri: vscode.Uri, panel: vscode.WebviewPanel, browserSmoke?: boolean) => PreviewBase;
}

interface PreviewProviderDefAlternative extends PreviewProviderDefCommon {
	onPreview(document: vscode.TextDocument): Promise<void>;
}

// What a preview has to say for itself. Whether it is on and which files are its own follow from
// its entry in previewFiles.
type PreviewOwn = { type: keyof typeof previewFiles } & Pick<PreviewProviderDefCommon, "displayName"> &
	(Pick<PreviewProviderDefNormal, "previewConstructor"> | Pick<PreviewProviderDefAlternative, "onPreview">);

export function definePreview(own: PreviewOwn): PreviewProviderDef {
	const files: PreviewFiles = previewFiles[own.type];
	const flag = files.flag;
	return {
		...own,
		...(flag !== undefined && { isEnabled: () => getFlags()[flag] }),
		canPreview: (document) => matchPreviewFiles(files, document),
	};
}
