import { Node, Token } from "../../hoiformat/hoiparser";
import { readNodeAsString } from "../../hoiformat/schema";
import { error } from "../../util/debug";
import { parseHoi4FileCached } from "../../util/fileloader";
import { FileLoader, FolderLoader, LoadResult, LoadResultOD } from "../../util/loader/loader";
import { flatten } from "lodash";

// A decision category that sets `scripted_gui = X` is drawn by a custom window instead of the usual
// list of buttons. X is defined in common/scripted_guis as
//
//   scripted_gui = { X = { window_name = "SOME_WINDOW" context_type = decision_category ... } }
//
// and SOME_WINDOW is a containerwindowtype somewhere under interface/. This module reads the middle
// step; util/guiwindowindex.ts does the last one.
export const scriptedGuisFolder = "common/scripted_guis";

export interface ScriptedGuiDef {
	name: string;
	windowName: string | undefined;
	contextType: string | undefined;
	token: Token | undefined;
	file: string;
}

export function getScriptedGuisFromFile(node: Node, filePath: string): ScriptedGuiDef[] {
	const result: ScriptedGuiDef[] = [];
	if (!Array.isArray(node.value)) {
		return result;
	}

	for (const wrapper of node.value) {
		if (wrapper.name?.toLowerCase() !== "scripted_gui" || !Array.isArray(wrapper.value)) {
			continue;
		}

		for (const gui of wrapper.value) {
			if (!gui.name || !Array.isArray(gui.value)) {
				continue;
			}

			let windowName: string | undefined;
			let contextType: string | undefined;
			for (const child of gui.value) {
				const childName = child.name?.toLowerCase();
				if (childName === "window_name") {
					windowName = readNodeAsString(child);
				} else if (childName === "context_type") {
					contextType = readNodeAsString(child);
				}
			}

			result.push({
				name: gui.name,
				windowName,
				contextType,
				token: gui.nameToken ?? undefined,
				file: filePath,
			});
		}
	}

	return result;
}

class ScriptedGuiFileLoader extends FileLoader<ScriptedGuiDef[]> {
	protected async loadFromFile(): Promise<LoadResultOD<ScriptedGuiDef[]>> {
		try {
			return { result: getScriptedGuisFromFile(await parseHoi4FileCached(this.file), this.file) };
		} catch (e) {
			// One unparseable file must not cost the preview every other scripted GUI.
			error(e);
			return { result: [] };
		}
	}

	public toString() {
		return `[ScriptedGuiFileLoader: ${this.file}]`;
	}
}

export class ScriptedGuisLoader extends FolderLoader<ScriptedGuiDef[], ScriptedGuiDef[]> {
	constructor() {
		super(scriptedGuisFolder, ScriptedGuiFileLoader);
	}

	protected mergeFiles(
		fileResults: LoadResult<ScriptedGuiDef[]>[],
	): Promise<LoadResult<ScriptedGuiDef[]>> {
		return Promise.resolve({
			result: flatten(fileResults.map((r) => r.result)),
			dependencies: [this.folder + "/*"],
		});
	}

	public toString() {
		return "[ScriptedGuisLoader]";
	}
}

export function scriptedGuisByName(defs: ScriptedGuiDef[]): Record<string, ScriptedGuiDef> {
	const result: Record<string, ScriptedGuiDef> = {};
	for (const def of defs) {
		if (!(def.name in result)) {
			result[def.name] = def;
		}
	}
	return result;
}
