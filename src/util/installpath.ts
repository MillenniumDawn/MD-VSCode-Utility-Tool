import * as vscode from 'vscode';
import { UserError } from './common';
import { localize } from './i18n';
import { fileOrUriStringToUri, getConfiguration, isDirectory, uriToFilePathWhenPossible } from './vsccommon';

// Resolved install path, cached until the setting changes or the folder picker overrides it.
// Owned here rather than in hoifs.ts because fileloader.ts needs it too and cannot import hoifs
// (hoifs imports clearDlcZipCache from fileloader).
const installPathContainer: { current: vscode.Uri | null } = {
    current: null,
};

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
    installPathContainer.current = uri;
}

export function clearInstallPathCache(): void {
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
        vscode.window.showErrorMessage(
            localize('installpath.notdirectory', "Hearts of Iron IV install path does not exist: {0}", uriToFilePathWhenPossible(installPath)));
    }
}
