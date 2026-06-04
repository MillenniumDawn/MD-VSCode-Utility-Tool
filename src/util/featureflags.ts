import * as vscode from 'vscode';
import { ConfigurationKey } from '../constants';
import { getConfiguration } from "./vsccommon";

// Live feature flags. These are `let` (not `const`) so they can be refreshed when the user changes
// settings, and ES-module live bindings mean importers always read the current value. Index-backed
// flags (sharedFocusIndex/gfxIndex/localisationIndex) still need a reload to (re)build their index;
// refreshing here keeps the flag consistent in the meantime.
export let useConditionInFocus = getConfiguration().useConditionInFocus;
export let eventTreePreview = getConfiguration().eventTreePreview;
export let sharedFocusIndex = getConfiguration().sharedFocusIndex;
export let gfxIndex = getConfiguration().gfxIndex;
export let localisationIndex = getConfiguration().localisationIndex;

export function refreshFeatureFlags(): void {
    const config = getConfiguration();
    useConditionInFocus = config.useConditionInFocus;
    eventTreePreview = config.eventTreePreview;
    sharedFocusIndex = config.sharedFocusIndex;
    gfxIndex = config.gfxIndex;
    localisationIndex = config.localisationIndex;
}

export function registerFeatureFlags(): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(ConfigurationKey)) {
            refreshFeatureFlags();
        }
    });
}
