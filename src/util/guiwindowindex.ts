import { GuiFile, guiFileSchema, ContainerWindowType } from "../hoiformat/gui";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { convertNodeToJson, HOIPartial } from "../hoiformat/schema";
import { PromiseCache } from "./cache";
import { scanCandidatesUntilResolved } from "./candidateScan";
import {
	hoiFileExpiryToken,
	listFilesFromModOrHOI4,
	parseAndResolveHoi4FileCached,
	readFileFromModOrHOI4,
} from "./fileloader";
import { describeParseFailure } from "./indexHalf";
import { localize } from "./i18n";
import { Logger } from "./logger";

// Finding a `containerwindowtype` by the name a script refers to it by. A focus inlay window and a
// decision category's `scripted_gui` both name a window and leave the reader to find it, and the
// game finds it the same way for both: by scanning the interface tree.
//
// Scripted GUI windows and their sprites can live anywhere under interface/ (e.g.
// interface/GER_inner_circle_scripted_gui.gui, interface/inner_circle.gfx), not just
// interface/scripted_gui, which does not even exist in vanilla. So the whole tree is scanned.
const guiInterfaceFolder = "interface";

export interface ResolvedGuiWindow {
	file: string;
	window: HOIPartial<ContainerWindowType>;
}

export async function listGuiFiles(): Promise<string[]> {
	return listInterfaceFiles(".gui");
}

export async function listGuiGfxFiles(): Promise<string[]> {
	return listInterfaceFiles(".gfx");
}

async function listInterfaceFiles(extension: string): Promise<string[]> {
	try {
		const files = await listFilesFromModOrHOI4(guiInterfaceFolder, { recursively: true });
		return files
			.filter((file) => file.toLowerCase().endsWith(extension))
			.map((file) => `${guiInterfaceFolder}/${file}`.replace(/\/+/g, "/"));
	} catch (e) {
		Logger.error(`Cannot list interface/ for ${extension} files: ${describeParseFailure(e)}`);
		return [];
	}
}

// The .gfx files under the folders a user setting names. A folder that does not exist anywhere is
// not an error to the file listing -- it simply lists nothing -- so a typo in the setting is only
// visible as an empty result, and that is reported here rather than left as a missing icon.
export async function listGfxFilesFromConfiguredRoots(
	roots: readonly (string | undefined | null)[],
	settingName: string,
): Promise<string[]> {
	const gfxFiles: string[] = [];
	for (const configuredRoot of roots) {
		if (!configuredRoot || configuredRoot.trim() === "") {
			continue;
		}
		const root = configuredRoot.replace(/\\+/g, "/");
		try {
			const files = await listFilesFromModOrHOI4(root, { recursively: true });
			let found = 0;
			for (const file of files) {
				if (file.toLowerCase().endsWith(".gfx")) {
					gfxFiles.push(`${root}/${file}`.replace(/\/+/g, "/"));
					found++;
				}
			}
			if (found === 0) {
				Logger.warn(`${settingName}: "${configuredRoot}" contains no .gfx files in the mod, its parent mods or the game install -- check the path`);
			}
		} catch (e) {
			Logger.error(`${settingName}: cannot list "${configuredRoot}": ${describeParseFailure(e)}`);
		}
	}
	return gfxFiles;
}

// The window names each .gui file defines, which is all the scan below looks at. The interface tree
// is several hundred files -- more than the shared parse cache holds -- so parsing them through it
// evicted the first file before the scan reached the last, and every refresh started cold. Names
// are a few hundred bytes per file, so all of them fit; only the file a name resolves to is parsed
// in full, and that one goes through the shared cache as before.
const guiWindowNamesCache = new PromiseCache<string[]>({
	factory: loadGuiWindowNames,
	expireWhenChange: hoiFileExpiryToken,
	life: 10 * 60 * 1000,
	maxSize: 4096,
});

async function loadGuiWindowNames(guiFile: string): Promise<string[]> {
	const [buffer, realPath] = await readFileFromModOrHOI4(guiFile);
	const node = parseHoi4File(
		buffer.toString().replace(/^﻿/, ""),
		localize("infile", "In file {0}:\n", realPath),
		{ keepTokens: false },
	);
	return Object.keys(collectContainerWindows(convertNodeToJson<GuiFile>(node, guiFileSchema)));
}

// Test-only: drop the window-name cache so a headless test starts clean.
export function _clearGuiWindowIndexForTest(): void {
	guiWindowNamesCache.clear();
}

// Resolves the given window names against the interface tree. The scan stops as soon as every name
// is accounted for, so asking for a handful of windows does not cost a walk of the whole tree. A
// name that no file defines is simply absent from the result -- what to say about that is the
// caller's to decide, since a focus inlay and a decision category word it differently.
export async function findContainerWindows(
	names: Iterable<string>,
	guiFiles?: string[],
): Promise<Record<string, ResolvedGuiWindow>> {
	const unresolved = new Set(names);
	const windowByName: Record<string, ResolvedGuiWindow> = {};
	if (unresolved.size === 0) {
		return windowByName;
	}

	const fileByName = new Map<string, string>();
	await scanCandidatesUntilResolved(
		guiFiles ?? (await listGuiFiles()),
		unresolved,
		async (guiFile) => {
			try {
				return await guiWindowNamesCache.get(guiFile);
			} catch (e) {
				Logger.error(`Cannot parse ${guiFile} while looking for window(s) ${[...unresolved].join(", ")}: ${describeParseFailure(e)}`);
				throw e;
			}
		},
		(guiFile, windowNames) => {
			for (const name of windowNames) {
				if (unresolved.delete(name)) {
					fileByName.set(name, guiFile);
				}
			}
		},
	);

	const windowsByFile = new Map<string, Record<string, HOIPartial<ContainerWindowType>>>();
	for (const [name, guiFile] of fileByName) {
		let windows = windowsByFile.get(guiFile);
		if (windows === undefined) {
			try {
				const guiNode = await parseAndResolveHoi4FileCached(guiFile);
				windows = collectContainerWindows(convertNodeToJson<GuiFile>(guiNode, guiFileSchema));
			} catch (e) {
				Logger.error(`Cannot parse ${guiFile} while resolving the container windows it names: ${describeParseFailure(e)}`);
				windows = {};
			}
			windowsByFile.set(guiFile, windows);
		}
		const window = windows[name];
		if (window !== undefined) {
			windowByName[name] = { file: guiFile, window };
		}
	}

	return windowByName;
}

export function collectContainerWindows(
	guiFile: HOIPartial<GuiFile>,
): Record<string, HOIPartial<ContainerWindowType>> {
	const result: Record<string, HOIPartial<ContainerWindowType>> = {};
	for (const guiTypes of guiFile.guitypes) {
		for (const containerWindow of [...guiTypes.containerwindowtype, ...guiTypes.windowtype]) {
			collectContainerWindowRecursive(containerWindow, result);
		}
	}
	return result;
}

function collectContainerWindowRecursive(
	containerWindow: HOIPartial<ContainerWindowType>,
	result: Record<string, HOIPartial<ContainerWindowType>>,
): void {
	if (containerWindow.name && !(containerWindow.name in result)) {
		result[containerWindow.name] = containerWindow;
	}
	for (const child of [...containerWindow.containerwindowtype, ...containerWindow.windowtype]) {
		collectContainerWindowRecursive(child, result);
	}
}