import * as vscode from "vscode";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { convertNodeToJson, Enum, SchemaDef } from "../hoiformat/schema";
import { PromiseCache } from "./cache";
import { clearDlcZipCache } from "./fileloader";
import { localize } from "./i18n";
import { Logger } from "./logger";
import { getSelectedModFileUri } from "./modfile";
import {
	getExplicitParentModUris,
	publishParentMods,
	setResolvedDependencies,
} from "./parentmods";
import {
	dirUri,
	fileOrUriStringToUri,
	getConfiguration,
	getLastModifiedAsync,
	isDirectory,
	isFile,
	readDir,
	readFile,
	uriToFilePathWhenPossible,
} from "./vsccommon";

/*
 * Parent mods from the `.mod`'s `dependencies`.
 *
 * A submod names the mods it extends in its descriptor: `dependencies = { "Millennium Dawn: A
 * Modern Day Mod" }`. The launcher keeps the folder for each such name in the game's user data
 * directory, one `mod/<something>.mod` per mod it knows, each with `name="..."` and `path="..."`.
 * Reading those turns the names into folders without the user copying them into
 * `parentModPaths` on every machine the submod is checked out on. The setting stays for what
 * cannot be resolved -- no launcher on this machine, a name the launcher never saw -- and an
 * entry there wins over the registry's folder for the same mod.
 */

interface ModDescriptor {
	name: string;
	path: string;
	dependencies: Enum;
}

const modDescriptorSchema: SchemaDef<ModDescriptor> = {
	name: "string",
	path: "string",
	dependencies: "enum",
};

interface ParsedDescriptor {
	name: string | undefined;
	path: string | undefined;
	dependencies: string[];
}

const descriptorCache = new PromiseCache({
	factory: parseDescriptor,
	expireWhenChange: (key) => getLastModifiedAsync(vscode.Uri.parse(key)),
	life: 60 * 1000,
});

async function parseDescriptor(uriString: string): Promise<ParsedDescriptor> {
	const uri = vscode.Uri.parse(uriString);
	const content = (await readFile(uri)).toString();
	const node = parseHoi4File(
		content,
		localize("infile", "In file {0}:\n", uriToFilePathWhenPossible(uri)),
	);
	const descriptor = convertNodeToJson<ModDescriptor>(node, modDescriptorSchema);
	return {
		name: descriptor.name,
		path: descriptor.path,
		dependencies: descriptor.dependencies?._values ?? [],
	};
}

// A descriptor that cannot be read counts as empty. The working mod's own is reported where it is
// read for replace_path; a registry entry is the launcher's business.
async function readDescriptor(
	uri: vscode.Uri,
): Promise<ParsedDescriptor | undefined> {
	try {
		return await descriptorCache.get(uri.toString());
	} catch (e) {
		Logger.warn(
			`[Parent mods] cannot read ${uriToFilePathWhenPossible(uri)}: ${String(e)}`,
		);
		return undefined;
	}
}

// The launcher writes these next to the `mod` folder; either one marks the user data directory.
const userDataMarkers = ["dlc_load.json", "launcher-v2.sqlite"];

async function isUserDataDir(dir: vscode.Uri): Promise<boolean> {
	if (!(await isDirectory(vscode.Uri.joinPath(dir, "mod")))) {
		return false;
	}
	for (const marker of userDataMarkers) {
		if (await isFile(vscode.Uri.joinPath(dir, marker))) {
			return true;
		}
	}
	return false;
}

// Slashes and case folded, and a trailing slash so `D:/ws` does not claim `D:/ws2`.
function folderKey(uri: vscode.Uri): string {
	return (
		uriToFilePathWhenPossible(uri).replace(/\\+/g, "/").replace(/\/+$/, "") +
		"/"
	).toLowerCase();
}

// A repository controls everything under its own folder, so a `mod/` and a `dlc_load.json` in a
// workspace folder are that repository's files, not the launcher's. Taking them for the registry
// would let a checked-out repo -- an untrusted one included, since the restricted settings say
// nothing about files -- name any folder on the machine as a parent mod and have the extension
// read it. Only a directory outside every workspace folder can be the user data directory.
function isInsideWorkspace(dir: vscode.Uri): boolean {
	const key = folderKey(dir);
	return (vscode.workspace.workspaceFolders ?? []).some((folder) =>
		key.startsWith(folderKey(folder.uri)),
	);
}

async function findUserDataDirUpwards(
	start: vscode.Uri,
): Promise<vscode.Uri | undefined> {
	let dir = start;
	for (;;) {
		if (!isInsideWorkspace(dir) && (await isUserDataDir(dir))) {
			return dir;
		}
		const parent = dirUri(dir);
		if (parent.path === dir.path) {
			return undefined;
		}
		dir = parent;
	}
}

function defaultUserDataDirs(): vscode.Uri[] {
	if (IS_WEB_EXT || typeof process === "undefined") {
		return [];
	}
	const home = process.env.USERPROFILE ?? process.env.HOME;
	if (!home) {
		return [];
	}
	const homeUri = vscode.Uri.file(home);
	return process.platform === "linux"
		? [
				vscode.Uri.joinPath(
					homeUri,
					".local",
					"share",
					"Paradox Interactive",
					"Hearts of Iron IV",
				),
			]
		: [
				vscode.Uri.joinPath(
					homeUri,
					"Documents",
					"Paradox Interactive",
					"Hearts of Iron IV",
				),
			];
}

/**
 * The game's user data directory, where the launcher keeps its mod registry. The setting when it
 * is given; else the nearest ancestor of the selected `.mod` or of a workspace folder that looks
 * like one and lies outside the workspace, which covers a mod checked out under `<user data>/mod/`
 * and a Documents folder that Windows has moved elsewhere; else the platform default. The setting
 * is exempt from the workspace check: it is a restricted setting, so an untrusted workspace cannot
 * supply it.
 */
export async function findUserDataDir(
	modFile: vscode.Uri | undefined,
): Promise<vscode.Uri | undefined> {
	const configured = fileOrUriStringToUri(getConfiguration().userDataPath);
	if (configured !== undefined) {
		return (await isUserDataDir(configured)) ? configured : undefined;
	}

	const starts: vscode.Uri[] = [];
	if (modFile !== undefined) {
		starts.push(dirUri(modFile));
	}
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		starts.push(folder.uri);
	}
	for (const start of starts) {
		const found = await findUserDataDirUpwards(start);
		if (found !== undefined) {
			return found;
		}
	}

	for (const candidate of defaultUserDataDirs()) {
		if (await isUserDataDir(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

// The registry files the launcher has enabled, as `mod/<file>` relative to the user data directory.
async function readEnabledMods(userDataDir: vscode.Uri): Promise<Set<string>> {
	try {
		const parsed = JSON.parse(
			(
				await readFile(vscode.Uri.joinPath(userDataDir, "dlc_load.json"))
			).toString(),
		) as { enabled_mods?: unknown };
		const enabled = Array.isArray(parsed.enabled_mods)
			? parsed.enabled_mods
			: [];
		return new Set(
			enabled
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.replace(/\\/g, "/").toLowerCase()),
		);
	} catch {
		return new Set();
	}
}

/**
 * Mod name -> folder, from every `.mod` in `<user data>/mod/`. An entry without a `path` (a zipped
 * mod, `archive=`) or whose folder is gone contributes nothing. Two entries with one name -- a
 * workshop copy and a local one -- go to the one the launcher has enabled, else the first by file
 * name, and the tie is logged.
 */
export async function loadModRegistry(
	userDataDir: vscode.Uri,
): Promise<Map<string, vscode.Uri>> {
	const registry = new Map<string, vscode.Uri>();
	const modDir = vscode.Uri.joinPath(userDataDir, "mod");
	let files: string[];
	try {
		files = (await readDir(modDir)).filter((f) => f.endsWith(".mod")).sort();
	} catch {
		return registry;
	}

	const enabled = await readEnabledMods(userDataDir);
	const decidedByLauncher = new Set<string>();
	for (const file of files) {
		const descriptor = await readDescriptor(vscode.Uri.joinPath(modDir, file));
		if (descriptor?.name === undefined || descriptor.path === undefined) {
			continue;
		}

		const folder = /^([a-zA-Z]:[\\/]|[\\/])/.test(descriptor.path)
			? vscode.Uri.file(descriptor.path)
			: vscode.Uri.joinPath(userDataDir, descriptor.path);
		if (!(await isDirectory(folder))) {
			continue;
		}

		const isEnabled = enabled.has(`mod/${file}`.toLowerCase());
		const existing = registry.get(descriptor.name);
		if (existing === undefined) {
			registry.set(descriptor.name, folder);
		} else {
			Logger.warn(
				`[Parent mods] two registry entries named "${descriptor.name}": ${uriToFilePathWhenPossible(existing)} and ${uriToFilePathWhenPossible(folder)}`,
			);
			if (isEnabled && !decidedByLauncher.has(descriptor.name)) {
				registry.set(descriptor.name, folder);
			}
		}
		if (isEnabled) {
			decidedByLauncher.add(descriptor.name);
		}
	}
	return registry;
}

async function resolveDependencies(): Promise<void> {
	const modFile = await getSelectedModFileUri();
	const own =
		modFile !== undefined && (await isFile(modFile))
			? await readDescriptor(modFile)
			: undefined;
	const dependencies = own?.dependencies ?? [];
	if (dependencies.length === 0) {
		setResolvedDependencies([], []);
		return;
	}

	const explicit = getExplicitParentModUris();
	// A dependency the setting already covers is left to the setting, even when the registry
	// knows a different folder for it: the explicit path is the one the user chose.
	const explicitNames = new Set<string>();
	for (const parent of explicit) {
		const descriptor = vscode.Uri.joinPath(parent, "descriptor.mod");
		if (await isFile(descriptor)) {
			const name = (await readDescriptor(descriptor))?.name;
			if (name !== undefined) {
				explicitNames.add(name);
			}
		}
	}

	const userDataDir = await findUserDataDir(modFile);
	if (userDataDir === undefined) {
		Logger.warn(
			"[Parent mods] no Hearts of Iron IV user data directory found; set mdHoi4Utilities.userDataPath to resolve the .mod dependencies",
		);
	}
	const registry =
		userDataDir !== undefined
			? await loadModRegistry(userDataDir)
			: new Map<string, vscode.Uri>();

	const resolved: vscode.Uri[] = [];
	const unresolved: string[] = [];
	for (const name of dependencies) {
		if (explicitNames.has(name)) {
			continue;
		}
		const folder = registry.get(name);
		if (folder === undefined) {
			unresolved.push(name);
		} else {
			resolved.push(folder);
		}
	}
	setResolvedDependencies(resolved, unresolved);
}

let inFlight: Promise<void> | null = null;
let rerun = false;

/**
 * Settles once the resolution in flight, if any, has published. An index build waits on this
 * before it lists or caches anything: both read the parent list, and a build that ran while the
 * list was being resolved listed the explicit parents alone and cached under a namespace that
 * never recurs. Never rejects, and resolves at once when nothing is in flight.
 */
export function whenModDependenciesSettled(): Promise<void> {
	return inFlight ?? Promise.resolve();
}

/**
 * Re-reads the selected `.mod`'s `dependencies` and the launcher's registry, and tells the parent
 * list's listeners when the outcome differs from last time. Never throws; a failure leaves the
 * dependencies unresolved and is logged. Calls made while one runs are folded into one more run
 * after it, so a burst of setting changes ends with the list that matches the last one.
 */
export function refreshModDependencies(): Promise<void> {
	if (inFlight !== null) {
		rerun = true;
		return inFlight;
	}

	inFlight = (async () => {
		do {
			rerun = false;
			try {
				await resolveDependencies();
			} catch (e) {
				Logger.error(
					`[Parent mods] resolving dependencies failed: ${String(e)}`,
				);
				setResolvedDependencies([], []);
			}
			if (publishParentMods()) {
				void clearDlcZipCache();
			}
		} while (rerun);
	})().finally(() => {
		inFlight = null;
	});
	return inFlight;
}
