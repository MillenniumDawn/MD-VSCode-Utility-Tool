import { GuiFile, guiFileSchema, ContainerWindowType } from "../hoiformat/gui";
import { convertNodeToJson, HOIPartial } from "../hoiformat/schema";
import { listFilesFromModOrHOI4, parseAndResolveHoi4FileCached } from "./fileloader";

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
	} catch {
		return [];
	}
}

// Resolves the given window names against the interface tree. Parsing stops as soon as every name
// is accounted for, so asking for a handful of windows does not cost a parse of the whole tree. A
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

	for (const guiFile of guiFiles ?? (await listGuiFiles())) {
		if (unresolved.size === 0) {
			break;
		}
		try {
			const guiNode = await parseAndResolveHoi4FileCached(guiFile);
			const guiFileData = convertNodeToJson<GuiFile>(guiNode, guiFileSchema);
			const windows = collectContainerWindows(guiFileData);
			for (const name of Object.keys(windows)) {
				if (unresolved.has(name) && !(name in windowByName)) {
					const window = windows[name];
					if (window !== undefined) {
						windowByName[name] = { file: guiFile, window };
					}
					unresolved.delete(name);
				}
			}
		} catch {
			continue;
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
