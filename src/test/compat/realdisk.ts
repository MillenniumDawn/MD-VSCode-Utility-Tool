// Mounts real folders behind the vscode stub: a mod as the workspace, a game install behind the
// `hoi4installpath:` scheme, and parent mods, all read straight from disk. The unit tests hand-feed
// `readFile`; this is for the checks that have to see a real mod as the extension would.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { restoreVscodeStubs, stubVscode } from '../_vscode_stub';
import { Hoi4FsSchema } from '../../constants';
import { clearDlcZipCache } from '../../util/fileloader';
import { clearInstallPathCache } from '../../util/installpath';
import { clearParentModCache } from '../../util/parentmods';
import { refreshFeatureFlags } from '../../util/featureflags';
import { _clearImageCachesForTest } from '../../util/image/imagecache';
import { workspaceModFilesCache } from '../../util/modfile';

export interface RealDiskOptions {
	modDir: string;
	/** The game install. Left out, the game is an empty folder: nothing from it resolves. */
	gameDir?: string;
	parentDirs?: string[];
	/** Settings on top of the extension's defaults and the paths above. */
	settings?: Record<string, unknown>;
}

export interface RealDisk {
	modDir: string;
	gameDir: string;
	unmount(): Promise<void>;
}

const installPrefix = Hoi4FsSchema + ':';

// Everything that remembers a file across loads. A second mount in the same process otherwise
// reads the first one's answers, and a failure it already logged is not logged again.
async function clearCaches(): Promise<void> {
	clearInstallPathCache();
	clearParentModCache();
	workspaceModFilesCache.clear();
	_clearImageCachesForTest();
	await clearDlcZipCache();
}

/** The extension's own setting defaults, as a fresh install would have them. */
export function defaultSettings(packageJsonFile: string): Record<string, unknown> {
	const pkg = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));
	const configuration = pkg.contributes?.configuration;
	const sections: any[] = Array.isArray(configuration) ? configuration : [configuration];
	const settings: Record<string, unknown> = {};
	for (const section of sections) {
		for (const [key, property] of Object.entries<any>(section?.properties ?? {})) {
			settings[key.replace(/^[^.]+\./, '')] = property.default;
		}
	}
	return settings;
}

export async function mountRealDisk(options: RealDiskOptions, packageJsonFile: string): Promise<RealDisk> {
	const emptyGame = options.gameDir === undefined
		? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hoi4-nogame-'))
		: undefined;
	const gameDir = options.gameDir ?? emptyGame!;

	const realPathOf = (uri: vscode.Uri): string => {
		const raw = String(uri.fsPath ?? uri.path ?? '');
		if (raw.startsWith(installPrefix)) {
			return path.join(gameDir, raw.slice(installPrefix.length).replace(/^\/+/, ''));
		}
		return raw.startsWith('file://') ? raw.slice('file://'.length) : raw;
	};

	const descriptor = path.join(options.modDir, 'descriptor.mod');
	const settings: Record<string, unknown> = {
		...defaultSettings(packageJsonFile),
		modFile: fs.existsSync(descriptor) ? descriptor : '',
		installPath: gameDir,
		parentModPaths: options.parentDirs ?? [],
		loadDlcContents: false,
		gfxIndex: false,
		localisationIndex: false,
		sharedFocusIndex: false,
		ideaSwapIndex: false,
		...options.settings,
	};

	await clearCaches();
	stubVscode({
		configuration: { ...settings, get: (key: string) => settings[key] },
		workspaceFolders: [{ uri: vscode.Uri.file(options.modDir), name: path.basename(options.modDir), index: 0 }],
		getWorkspaceFolder: (uri: vscode.Uri) => {
			const file = path.resolve(realPathOf(uri));
			const root = path.resolve(options.modDir);
			return file === root || file.startsWith(root + path.sep)
				? { uri: vscode.Uri.file(options.modDir), name: path.basename(options.modDir), index: 0 }
				: undefined;
		},
		stat: async uri => {
			const stat = await fs.promises.stat(realPathOf(uri));
			return {
				type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
				mtime: stat.mtimeMs,
				ctime: stat.birthtimeMs,
				size: stat.size,
			};
		},
		readDirectory: async uri => {
			const entries = await fs.promises.readdir(realPathOf(uri), { withFileTypes: true });
			return entries.map(e => [e.name, e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File] as [string, number]);
		},
		readFile: async uri => fs.promises.readFile(realPathOf(uri)),
	});
	refreshFeatureFlags();

	return {
		modDir: options.modDir,
		gameDir,
		async unmount() {
			restoreVscodeStubs();
			refreshFeatureFlags();
			await clearCaches();
			if (emptyGame) {
				await fs.promises.rmdir(emptyGame);
			}
		},
	};
}
