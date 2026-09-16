import * as vscode from "vscode";
import { localize } from "./i18n";
import {
	fileOrUriStringToUri,
	getConfiguration,
	isDirectory,
	uriToFilePathWhenPossible,
} from "./vsccommon";

// The folders of the mods this workspace extends, in the order the setting lists them, cached
// until the setting changes. Owned here rather than in hoifs.ts for the same reason as the
// install path: fileloader.ts reads it on every lookup and cannot import hoifs.
const parentModsContainer: { current: vscode.Uri[] | null } = {
	current: null,
};

/**
 * Each entry is a plain string typed by hand, so it gets the same normalization as modFile and
 * installPath (whitespace trimmed, a matched pair of surrounding quotes stripped). Blank entries
 * are dropped rather than resolved to the workspace root.
 */
export function getParentModUris(): vscode.Uri[] {
	if (parentModsContainer.current !== null) {
		return parentModsContainer.current;
	}

	const paths = getConfiguration().parentModPaths ?? [];
	const uris: vscode.Uri[] = [];
	for (const entry of paths) {
		if (typeof entry !== "string" || entry.trim() === "") {
			continue;
		}
		const uri = fileOrUriStringToUri(entry);
		if (uri !== undefined) {
			uris.push(uri);
		}
	}

	return (parentModsContainer.current = uris);
}

export function clearParentModCache(): void {
	parentModsContainer.current = null;
}

// A wrong parent path fails silently everywhere else: lookups fall through to vanilla and the
// preview renders blank icons, exactly what the setting exists to fix. Report it at activation
// and on every change of the setting.
export async function checkParentModPaths(): Promise<void> {
	for (const parent of getParentModUris()) {
		if (!(await isDirectory(parent))) {
			vscode.window.showErrorMessage(
				localize(
					"parentmods.notdirectory",
					"Parent mod path does not exist: {0}",
					uriToFilePathWhenPossible(parent),
				),
			);
		}
	}
}
