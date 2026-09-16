import * as assert from "assert";
import * as vscode from "vscode";
import { clearDlcZipCache, getFilePathFromModOrHOI4 } from "../util/fileloader";
import {
	refreshModDependencies,
	whenModDependenciesSettled,
} from "../util/moddependencies";
import { workspaceModFilesCache } from "../util/modfile";
import {
	getParentModUris,
	getUnresolvedDependencies,
	onDidChangeParentMods,
	ParentModsChangeEvent,
	resetParentModsForTest,
} from "../util/parentmods";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// A submod names the mods it extends in its `.mod`; the launcher's registry -- one `.mod` per
// known mod under `<user data>/mod/`, each with `name` and `path` -- turns those names into
// folders. Real folders, so what is stat'ed and listed is what the extension would see.
describe("util/moddependencies", function () {
	const nodeFs = require("fs/promises") as typeof import("fs/promises");
	const nodePath = require("path") as typeof import("path");
	const nodeOs = require("os") as typeof import("os");

	let root: string;
	let workspaceDir: string;
	let userDataDir: string;
	let parentDir: string;
	let modFile: string;
	let config: Record<string, unknown>;
	let published: number;
	let events: ParentModsChangeEvent[];

	function realPathOf(uri: unknown): string {
		return String((uri as { fsPath: string }).fsPath);
	}

	function resolvedPaths(uris: readonly vscode.Uri[]): string[] {
		return uris.map((uri) => nodePath.resolve(realPathOf(uri)));
	}

	async function write(fullPath: string, content = "x"): Promise<void> {
		await nodeFs.mkdir(nodePath.dirname(fullPath), { recursive: true });
		await nodeFs.writeFile(fullPath, content);
	}

	function toModPath(fullPath: string): string {
		return fullPath.replace(/\\/g, "/");
	}

	/** A launcher registry entry: `<user data>/mod/<file>.mod` naming a folder. */
	async function registerMod(
		file: string,
		name: string,
		folder: string | undefined,
		extra = "",
	): Promise<void> {
		await write(
			nodePath.join(userDataDir, "mod", `${file}.mod`),
			`name="${name}"\n${folder === undefined ? "" : `path="${folder}"\n`}${extra}`,
		);
	}

	async function writeOwnModFile(dependencies: string[]): Promise<void> {
		const block =
			dependencies.length === 0
				? ""
				: `dependencies={\n${dependencies.map((d) => `\t"${d}"\n`).join("")}}\n`;
		await write(modFile, `name="sub"\n${block}`);
	}

	beforeEach(async function () {
		root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "hoi4deps-"));
		workspaceDir = nodePath.join(root, "ws");
		userDataDir = nodePath.join(root, "userdata");
		parentDir = nodePath.join(root, "parent");
		modFile = nodePath.join(workspaceDir, "descriptor.mod");
		published = 0;
		events = [];
		await write(nodePath.join(workspaceDir, "interface", "subonly.gfx"), "ws");
		await write(nodePath.join(parentDir, "interface", "shared.gfx"), "parent");
		await write(nodePath.join(parentDir, "descriptor.mod"), 'name="Parent Mod"\n');
		await write(
			nodePath.join(userDataDir, "dlc_load.json"),
			'{"enabled_mods":[],"disabled_dlcs":[]}',
		);
		await nodeFs.mkdir(nodePath.join(userDataDir, "mod"), { recursive: true });

		config = {
			modFile: "",
			installPath: "",
			loadDlcContents: false,
			parentModPaths: [],
			userDataPath: userDataDir,
		};
		resetParentModsForTest();
		workspaceModFilesCache.clear();
		stubVscode({
			getConfiguration: () => config,
			workspaceFolders: [{ uri: vscode.Uri.file(workspaceDir) }],
			stat: async (uri: unknown) => {
				const stat = await nodeFs.stat(realPathOf(uri));
				return {
					type: stat.isDirectory()
						? vscode.FileType.Directory
						: vscode.FileType.File,
					mtime: stat.mtime.getTime(),
					ctime: stat.birthtime.getTime(),
					size: stat.size,
				};
			},
			readDirectory: async (uri: unknown) => {
				const dirents = await nodeFs.readdir(realPathOf(uri), {
					withFileTypes: true,
				});
				return dirents.map(
					(dirent) =>
						[
							dirent.name,
							dirent.isDirectory()
								? vscode.FileType.Directory
								: vscode.FileType.File,
						] as [string, number],
				);
			},
			readFile: async (uri: unknown) => nodeFs.readFile(realPathOf(uri)),
		});
		onDidChangeParentMods((e) => {
			published++;
			events.push(e);
		});
	});

	/** Points the platform default user data directory somewhere empty for one test. */
	async function withoutDefaultUserDataDir(body: () => Promise<void>): Promise<void> {
		const home = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
		process.env.USERPROFILE = root;
		process.env.HOME = root;
		try {
			await body();
		} finally {
			process.env.USERPROFILE = home.USERPROFILE;
			process.env.HOME = home.HOME;
		}
	}

	afterEach(async function () {
		restoreVscodeStubs();
		resetParentModsForTest();
		workspaceModFilesCache.clear();
		await clearDlcZipCache();
		await nodeFs.rm(root, { recursive: true, force: true });
	});

	it("resolves a dependency to the folder the launcher's registry names for it", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
		assert.deepStrictEqual(getUnresolvedDependencies(), []);
		assert.strictEqual(published, 1);
	});

	it("makes the parent's files reachable without a parentModPaths entry", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		await refreshModDependencies();

		const found = await getFilePathFromModOrHOI4("interface/shared.gfx");
		assert.ok(found !== undefined, "shared.gfx should resolve through the parent");
		assert.strictEqual(
			nodePath.resolve(realPathOf(found)),
			nodePath.resolve(parentDir, "interface", "shared.gfx"),
		);
	});

	it("reads a registry path relative to the user data directory", async function () {
		const localParent = nodePath.join(userDataDir, "mod", "local-parent");
		await write(nodePath.join(localParent, "interface", "x.gfx"));
		await writeOwnModFile(["Local Parent"]);
		await registerMod("local-parent", "Local Parent", "mod/local-parent");

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(localParent),
		]);
	});

	it("keeps the .mod's order and lists what did not resolve", async function () {
		const secondDir = nodePath.join(root, "second");
		await nodeFs.mkdir(secondDir, { recursive: true });
		await writeOwnModFile(["Zipped Mod", "Second", "Gone Mod", "Unknown", "Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		await registerMod("ugc_2", "Second", toModPath(secondDir));
		// A zipped mod has an archive and no folder; a folder that was deleted resolves to nothing.
		await registerMod("ugc_3", "Zipped Mod", undefined, 'archive="mod/zipped.zip"\n');
		await registerMod("ugc_4", "Gone Mod", toModPath(nodePath.join(root, "gone")));

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(secondDir),
			nodePath.resolve(parentDir),
		]);
		assert.deepStrictEqual(getUnresolvedDependencies(), [
			"Zipped Mod",
			"Gone Mod",
			"Unknown",
		]);
	});

	it("leaves a dependency to the parentModPaths entry that carries its name", async function () {
		const checkout = nodePath.join(root, "checkout");
		await write(nodePath.join(checkout, "descriptor.mod"), 'name="Parent Mod"\n');
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		config.parentModPaths = [checkout];

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(checkout),
		]);
		assert.deepStrictEqual(getUnresolvedDependencies(), []);
	});

	it("puts the setting's entries before the resolved ones and never lists a folder twice", async function () {
		const explicitDir = nodePath.join(root, "explicit");
		await nodeFs.mkdir(explicitDir, { recursive: true });
		await writeOwnModFile(["Parent Mod", "Explicit"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		await registerMod("ugc_2", "Explicit", toModPath(explicitDir));
		config.parentModPaths = [explicitDir];

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(explicitDir),
			nodePath.resolve(parentDir),
		]);
	});

	it("prefers the registry entry the launcher has enabled when two share a name", async function () {
		const workshopDir = nodePath.join(root, "workshop");
		await nodeFs.mkdir(workshopDir, { recursive: true });
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("aaa_local", "Parent Mod", toModPath(parentDir));
		await registerMod("ugc_1", "Parent Mod", toModPath(workshopDir));
		await write(
			nodePath.join(userDataDir, "dlc_load.json"),
			'{"enabled_mods":["mod/ugc_1.mod"],"disabled_dlcs":[]}',
		);

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(workshopDir),
		]);
	});

	it("falls back to the first entry by file name when the launcher enabled neither", async function () {
		const workshopDir = nodePath.join(root, "workshop");
		await nodeFs.mkdir(workshopDir, { recursive: true });
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("aaa_local", "Parent Mod", toModPath(parentDir));
		await registerMod("ugc_1", "Parent Mod", toModPath(workshopDir));

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
	});

	it("finds the user data directory above a workspace checked out under its mod folder", async function () {
		const nestedWorkspace = nodePath.join(userDataDir, "mod", "nested-sub");
		const nestedModFile = nodePath.join(nestedWorkspace, "descriptor.mod");
		await write(nestedModFile, 'name="nested"\ndependencies={ "Parent Mod" }\n');
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		config.userDataPath = "";
		stubVscode({ workspaceFolders: [{ uri: vscode.Uri.file(nestedWorkspace) }] });

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
	});

	it("finds the user data directory above the selected .mod file", async function () {
		const registryModFile = nodePath.join(userDataDir, "mod", "sub.mod");
		await write(registryModFile, 'name="sub"\ndependencies={ "Parent Mod" }\n');
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		config.userDataPath = "";
		config.modFile = registryModFile;
		// The workspace is elsewhere and has no marker above it within the temp root.
		stubVscode({ workspaceFolders: [{ uri: vscode.Uri.file(workspaceDir) }] });

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
	});

	// The repository controls everything under its own folder. A launcher layout in there -- the
	// markers, a registry entry naming any folder on the machine, a `.mod` depending on it -- would
	// otherwise make the extension read that folder, in an untrusted workspace too, since the
	// restricted settings say nothing about files.
	it("ignores a launcher layout inside the workspace itself", async function () {
		await withoutDefaultUserDataDir(async () => {
			await write(nodePath.join(workspaceDir, "dlc_load.json"), '{"enabled_mods":[]}');
			await write(
				nodePath.join(workspaceDir, "mod", "evil.mod"),
				`name="Parent Mod"\npath="${toModPath(parentDir)}"\n`,
			);
			await writeOwnModFile(["Parent Mod"]);
			config.userDataPath = "";

			await refreshModDependencies();

			assert.deepStrictEqual(getParentModUris(), []);
			assert.deepStrictEqual(getUnresolvedDependencies(), ["Parent Mod"]);
		});
	});

	it("still finds the user data directory above a workspace that carries the markers too", async function () {
		const nestedWorkspace = nodePath.join(userDataDir, "mod", "nested-sub");
		await write(
			nodePath.join(nestedWorkspace, "descriptor.mod"),
			'name="nested"\ndependencies={ "Parent Mod" }\n',
		);
		await write(nodePath.join(nestedWorkspace, "dlc_load.json"), '{"enabled_mods":[]}');
		await write(
			nodePath.join(nestedWorkspace, "mod", "evil.mod"),
			`name="Parent Mod"\npath="${toModPath(nodePath.join(root, "evil"))}"\n`,
		);
		await nodeFs.mkdir(nodePath.join(root, "evil"), { recursive: true });
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		config.userDataPath = "";
		stubVscode({ workspaceFolders: [{ uri: vscode.Uri.file(nestedWorkspace) }] });

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
	});

	it("keeps the setting's entries and reports every name when there is no registry", async function () {
		const plainCheckout = nodePath.join(root, "plain");
		await nodeFs.mkdir(plainCheckout, { recursive: true });
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		config.userDataPath = nodePath.join(root, "nowhere");
		config.parentModPaths = [plainCheckout];

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(plainCheckout),
		]);
		assert.deepStrictEqual(getUnresolvedDependencies(), ["Parent Mod"]);
	});

	it("resolves nothing for a .mod without dependencies", async function () {
		await writeOwnModFile([]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		await refreshModDependencies();

		assert.deepStrictEqual(getParentModUris(), []);
		assert.deepStrictEqual(getUnresolvedDependencies(), []);
		assert.strictEqual(published, 0);
	});

	it("tells the listeners only when the list differs from what they last heard", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		await refreshModDependencies();
		await refreshModDependencies();

		assert.strictEqual(published, 1);
	});

	it("tells the listeners when only the unresolved names change", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));
		await refreshModDependencies();

		// Past the descriptor cache's grace period, with an mtime it cannot mistake for the old one.
		const now = Date.now();
		stubVscode({ now: () => now + 5000 });
		await writeOwnModFile(["Parent Mod", "Typo Mod"]);
		await nodeFs.utimes(modFile, new Date(now + 5000), new Date(now + 5000));

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
		assert.deepStrictEqual(getUnresolvedDependencies(), ["Typo Mod"]);
		assert.deepStrictEqual(events, [
			{ folders: true, unresolved: false },
			{ folders: false, unresolved: true },
		]);
	});

	it("lets a build wait for the resolution in flight, and not at all when there is none", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		let settled = false;
		void whenModDependenciesSettled().then(() => {
			settled = true;
		});
		await Promise.resolve();
		assert.strictEqual(settled, true, "nothing in flight settles at once");

		void refreshModDependencies();
		await whenModDependenciesSettled();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
		assert.strictEqual(published, 1);
	});

	it("folds calls made during a resolution into one more run", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		const first = refreshModDependencies();
		const second = refreshModDependencies();
		assert.strictEqual(first, second);
		await Promise.all([first, second]);

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
		assert.strictEqual(published, 1);
	});

	it("survives an unreadable registry entry", async function () {
		await writeOwnModFile(["Parent Mod"]);
		await write(nodePath.join(userDataDir, "mod", "broken.mod"), 'name="Broken\n{{{\n');
		await registerMod("ugc_1", "Parent Mod", toModPath(parentDir));

		await refreshModDependencies();

		assert.deepStrictEqual(resolvedPaths(getParentModUris()), [
			nodePath.resolve(parentDir),
		]);
	});
});
