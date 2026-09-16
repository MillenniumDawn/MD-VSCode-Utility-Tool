import * as vscode from 'vscode';
import * as featureflags from '../util/featureflags';
import { __resetLocalisationIndexForTests } from '../util/localisationIndex';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

// Turns the localisation index on and feeds it one English .yml so a preview test can render with
// real localised text -- including a hostile value -- instead of the key echo the off state gives.
// The fileloader is patched in place because that is the seam the index reads through; the stub
// `vscode.env` has no language, so the preview language is pinned to English.

type ListedEntry = { relativePath: string; uri: unknown; mtime: number | undefined };

type FileloaderModule = {
    listFileEntriesFromModOrHOI4: (relativePath: string, options?: unknown) => Promise<ListedEntry[]>;
    readFileFromModOrHOI4: (relativePath: string, options?: unknown) => Promise<[Buffer, unknown]>;
};

const fileloader = require('../util/fileloader') as FileloaderModule;

const WORKSPACE_FOLDER = {
    uri: { path: '/ws', scheme: 'file', toString: () => 'file:///ws' },
} as unknown as vscode.WorkspaceFolder;

let original: FileloaderModule | undefined;

/** Installs the index over `entries` (key -> value, written as `l_english` lines). Pair with `restoreLocalisation`. */
export function stubLocalisation(entries: Record<string, string>): void {
    const yml = 'l_english:\n' + Object.entries(entries).map(([key, value]) => ` ${key}:0 "${value}"`).join('\n') + '\n';

    __resetLocalisationIndexForTests();
    stubVscode({
        getConfiguration: () => ({ localisationIndex: true, previewLocalisation: 'English' }),
        getWorkspaceFolder: () => WORKSPACE_FOLDER,
    });
    featureflags.refreshFeatureFlags();

    original = {
        listFileEntriesFromModOrHOI4: fileloader.listFileEntriesFromModOrHOI4,
        readFileFromModOrHOI4: fileloader.readFileFromModOrHOI4,
    };
    fileloader.listFileEntriesFromModOrHOI4 = async () => [{ relativePath: 'test_l_english.yml', uri: undefined, mtime: 1 }];
    fileloader.readFileFromModOrHOI4 = async () => [Buffer.from(yml), {}];
}

export function restoreLocalisation(): void {
    if (original) {
        fileloader.listFileEntriesFromModOrHOI4 = original.listFileEntriesFromModOrHOI4;
        fileloader.readFileFromModOrHOI4 = original.readFileFromModOrHOI4;
        original = undefined;
    }
    restoreVscodeStubs();
    featureflags.refreshFeatureFlags();
    __resetLocalisationIndexForTests();
}
