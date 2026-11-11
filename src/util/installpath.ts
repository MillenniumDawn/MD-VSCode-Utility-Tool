import type * as vscode from 'vscode';
import { host } from './host';
import { UserError } from './common';
import { localize } from './i18n';
import { fileOrUriStringToUri, getConfiguration, isDirectory, uriToFilePathWhenPossible } from './vsccommon';

// Resolved install path, cached until the setting changes or the folder picker overrides it.
// Owned here rather than in hoifs.ts because fileloader.ts needs it too and cannot import hoifs
// (hoifs imports clearDlcZipCache from fileloader).
const installPathContainer: { current: vscode.Uri | null } = {
    current: null,
};

// A web or remote folder picker can override the setting without writing configuration.
let selectedPath: { uri: vscode.Uri; configuration: string | undefined } | undefined;
const installPathListeners = new Set<() => void>();

export function onDidSelectInstallPath(listener: () => void): vscode.Disposable {
    installPathListeners.add(listener);
    return { dispose: () => { installPathListeners.delete(listener); } };
}

/** The picker override, while its setting is unchanged, or the current configured path. */
export function getEffectiveInstallPathUri(): vscode.Uri | undefined {
    const configuration = getConfiguration().installPath;
    if (selectedPath && selectedPath.configuration !== configuration) {
        selectedPath = undefined;
    }
    const uri = selectedPath?.uri ?? fileOrUriStringToUri(configuration ?? '');
    // A new index generation must read through the same source its identity describes.
    installPathContainer.current = uri ?? null;
    return uri;
}

// The setting is a plain string typed by hand as often as it is written by the folder picker, so
// it goes through the same normalization as modFile: whitespace trimmed and a matched pair of
// surrounding quotes stripped (Windows Explorer's "Copy as path" wraps the path in double
// quotes). Without it every hoi4installpath: lookup silently misses.
function resolveInstallPath(): vscode.Uri | undefined {
    if (installPathContainer.current !== null) {
        return installPathContainer.current;
    }

    const uri = fileOrUriStringToUri(getConfiguration().installPath ?? '');
    if (uri === undefined) {
        return undefined;
    }

    return installPathContainer.current = uri;
}

export function getInstallPathUri(): vscode.Uri {
    const installPath = resolveInstallPath();
    if (installPath === undefined) {
        throw new UserError(localize('installpath.notset', "Install path of Hearts of Iron IV is not set."));
    }

    return installPath;
}

export function setInstallPathUri(uri: vscode.Uri): void {
    const previous = getEffectiveInstallPathUri()?.toString();
    selectedPath = { uri, configuration: getConfiguration().installPath };
    installPathContainer.current = uri;
    if (previous !== uri.toString()) {
        for (const listener of [...installPathListeners]) { listener(); }
    }
}

export function clearInstallPathCache(): void {
    selectedPath = undefined;
    installPathContainer.current = null;
}

// A wrong install path fails silently everywhere else: lookups just miss and previews render
// blank icons. Report it once at activation and on every change of the setting.
export async function checkInstallPath(): Promise<void> {
    const installPath = resolveInstallPath();
    if (installPath === undefined) {
        // Not set at all is the normal first-run state, don't nag about it.
        return;
    }

    if (!(await isDirectory(installPath))) {
        void host().window.showErrorMessage(
            localize('installpath.notdirectory', "Hearts of Iron IV install path does not exist: {0}", uriToFilePathWhenPossible(installPath)));
    }
}
