import * as vscode from 'vscode';
import { ConfigurationKey } from '../constants';
import { getConfiguration } from "./vsccommon";

// Live feature flags. These are `let` (not `const`) so they can be refreshed when the user changes
// settings. Importers using ES `import { ... }` syntax read the property dynamically at access time
// (TypeScript compiles to `const mod = require(...); mod.flag`), so they always see the current value. Index-backed
// flags (sharedFocusIndex/gfxIndex/localisationIndex/ideaSwapIndex) still need a reload to (re)build their index;
// refreshing here keeps the flag consistent in the meantime.
export let useConditionInFocus = getConfiguration().useConditionInFocus;
export let eventTreePreview = getConfiguration().eventTreePreview;
export let ideaPreview = getConfiguration().ideaPreview;
export let decisionPreview = getConfiguration().decisionPreview;
export let characterPreview = getConfiguration().characterPreview;
export let ideaSwapIndex = getConfiguration().ideaSwapIndex;
export let sharedFocusIndex = getConfiguration().sharedFocusIndex;
export let gfxIndex = getConfiguration().gfxIndex;
export let localisationIndex = getConfiguration().localisationIndex;
// Not a feature flag as such, but it is read once per localised string a preview resolves --
// thousands of times in a single tech tree render -- and building a configuration proxy that
// often is pure overhead. It lives here because this is what already refreshes on a settings
// change, so there is no second thing to keep in step.
export let previewLocalisation = getConfiguration().previewLocalisation;

export function refreshFeatureFlags(): void {
    const config = getConfiguration();
    useConditionInFocus = config.useConditionInFocus;
    eventTreePreview = config.eventTreePreview;
    ideaPreview = config.ideaPreview;
    decisionPreview = config.decisionPreview;
    characterPreview = config.characterPreview;
    ideaSwapIndex = config.ideaSwapIndex;
    sharedFocusIndex = config.sharedFocusIndex;
    gfxIndex = config.gfxIndex;
    localisationIndex = config.localisationIndex;
    previewLocalisation = config.previewLocalisation;
}

export function registerFeatureFlags(): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(ConfigurationKey)) {
            refreshFeatureFlags();
        }
    });
}
