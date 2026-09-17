import * as vscode from "vscode";
import { localize } from "./i18n";
import {
	fileOrUriStringToUri,
	getConfiguration,
	isDirectory,
	uriToFilePathWhenPossible,
} from "./vsccommon";

// The folders of the mods this workspace extends: the setting's entries in the order it lists
// them, then the ones resolved from the selected `.mod`'s `dependencies` (see moddependencies.ts),
// cached until either changes. Owned here rather than in hoifs.ts for the same reason as the
// install path: fileloader.ts reads it on every lookup and cannot import hoifs.
const parentModsContainer: {
	current: vscode.Uri[] | null;
	resolved: vscode.Uri[];
	unresolved: string[];
	// What the listeners last heard, so a refresh that lands on the same outcome stays quiet.
	lastPublished: { folders: string[]; unresolved: string[] };
} = {
	current: null,
	resolved: [],
	unresolved: [],
	lastPublished: { folders: [], unresolved: [] },
};

/**
 * What a resolution changed. The indexes act on `folders` alone: a name that resolved to nothing
 * coming or going changes no file the parent half reads. The status bar redraws on either, because
 * its tooltip lists the unresolved names.
 */
export interface ParentModsChangeEvent {
	folders: boolean;
	unresolved: boolean;
}

// A plain listener set rather than a vscode.EventEmitter: the indexes and the status bar subscribe
// to it, and the tests drive it, without going through the editor.
const listeners = new Set<(e: ParentModsChangeEvent) => void>();

/**
 * The setting as a list of non-blank strings, whatever settings.json actually holds. The schema says
 * array, but a hand-typed `"parentModPaths": "D:\mods\parent"` gets through, and iterating that
 * with `for...of` yields one bogus one-character parent per letter -- an error toast for each, and a
 * stat of each on every lookup. A lone string is read as the one entry it was meant to be.
 */
export function normalizeParentModPathSetting(raw: unknown): string[] {
	const entries = Array.isArray(raw)
		? raw
		: typeof raw === "string"
			? [raw]
			: [];
	const paths: string[] = [];
	for (const entry of entries) {
		if (typeof entry === "string" && entry.trim() !== "") {
			paths.push(entry);
		}
	}
	return paths;
}

/**
 * The setting's entries alone, each normalized like modFile and installPath (whitespace trimmed, a
 * matched pair of surrounding quotes stripped). Blank entries are dropped rather than resolved to
 * the workspace root.
 */
export function getExplicitParentModUris(): vscode.Uri[] {
	const uris: vscode.Uri[] = [];
	for (const entry of normalizeParentModPathSetting(
		getConfiguration().parentModPaths,
	)) {
		const uri = fileOrUriStringToUri(entry);
		if (uri !== undefined) {
			uris.push(uri);
		}
	}
	return uris;
}

// Slashes normalized, so the setting's `D:\mods\parent` and the registry's `D:/mods/parent`
// count as the one folder on Windows. Linux keeps case because `/mods/Parent` and `/mods/parent`
// are distinct folders there.
function uriKey(uri: vscode.Uri): string {
	const normalized = uriToFilePathWhenPossible(uri).replace(/\\+/g, "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Every parent in search order: the setting's entries first, so an explicit folder wins over the
 * one the launcher's registry knows for the same mod, then the resolved dependencies that are not
 * already listed. Until the first resolution lands this is the setting alone.
 */
export function getParentModUris(): vscode.Uri[] {
	if (parentModsContainer.current !== null) {
		return parentModsContainer.current;
	}

	const uris = getExplicitParentModUris();
	const seen = new Set(uris.map(uriKey));
	for (const resolved of parentModsContainer.resolved) {
		const key = uriKey(resolved);
		if (!seen.has(key)) {
			seen.add(key);
			uris.push(resolved);
		}
	}

	return (parentModsContainer.current = uris);
}

/** Drops the cached list; the resolved dependencies stay until the next resolution replaces them. */
export function clearParentModCache(): void {
	parentModsContainer.current = null;
}

/**
 * The folders the `.mod`'s `dependencies` resolved to, in the order the file lists them, and the
 * names that resolved to nothing (shown in the status bar tooltip, so a typo in the name or a
 * launcher that never saw the mod is visible somewhere).
 */
export function setResolvedDependencies(
	uris: readonly vscode.Uri[],
	unresolvedNames: readonly string[],
): void {
	parentModsContainer.resolved = [...uris];
	parentModsContainer.unresolved = [...unresolvedNames];
	parentModsContainer.current = null;
}

export function getUnresolvedDependencies(): string[] {
	return parentModsContainer.unresolved;
}

export function onDidChangeParentMods(
	listener: (e: ParentModsChangeEvent) => void,
): vscode.Disposable {
	listeners.add(listener);
	return new vscode.Disposable(() => {
		listeners.delete(listener);
	});
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/**
 * Tells the listeners when the effective list, or the names that resolved to nothing, differ from
 * what they last heard. Called at the end of every resolution, whichever setting or file started
 * it, so the indexes rebuild their parent half once with the final list rather than once per
 * input.
 *
 * @returns whether the folder list changed -- what the file caches depend on.
 */
export function publishParentMods(): boolean {
	const folders = getParentModUris().map((uri) => uri.toString());
	const unresolved = [...parentModsContainer.unresolved];
	const previous = parentModsContainer.lastPublished;
	const event: ParentModsChangeEvent = {
		folders: !sameList(folders, previous.folders),
		unresolved: !sameList(unresolved, previous.unresolved),
	};
	if (!event.folders && !event.unresolved) {
		return false;
	}

	parentModsContainer.lastPublished = { folders, unresolved };
	for (const listener of listeners) {
		listener(event);
	}
	return event.folders;
}

/** Test hook: forgets the resolved dependencies, the listeners and what was last published. */
export function resetParentModsForTest(): void {
	parentModsContainer.current = null;
	parentModsContainer.resolved = [];
	parentModsContainer.unresolved = [];
	parentModsContainer.lastPublished = { folders: [], unresolved: [] };
	listeners.clear();
}

// A wrong parent path fails silently everywhere else: lookups fall through to vanilla and the
// preview renders blank icons, exactly what the setting exists to fix. Report it at activation
// and on every change of the setting. Only the setting's entries: a resolved dependency was
// checked to be a folder before it got in.
export async function checkParentModPaths(): Promise<void> {
	for (const parent of getExplicitParentModUris()) {
		if (!(await isDirectory(parent))) {
			void vscode.window.showErrorMessage(
				localize(
					"parentmods.notdirectory",
					"Parent mod path does not exist: {0}",
					uriToFilePathWhenPossible(parent),
				),
			);
		}
	}
}
