import * as vscode from 'vscode';
import { ConfigurationKey } from '../constants';
import { getConfiguration } from "./vsccommon";

type Configuration = ReturnType<typeof getConfiguration>;

// Feature flags, read through getFlags() at the point of use. A settings change replaces the whole
// object rather than mutating it, so call getFlags() each time a flag is needed and never keep the
// result in a module-level constant: a held object keeps the values it was read with. This used to
// be a set of `export let` bindings, which stayed current only because TypeScript emits CommonJS and
// every import compiles to a property read; an accessor keeps that guarantee under any module format.
// Index-backed flags (sharedFocusIndex/gfxIndex/localisationIndex/ideaSwapIndex) still need a reload
// to (re)build their index; refreshing here keeps the flag consistent in the meantime.
export interface FeatureFlags {
    readonly useConditionInFocus: Configuration['useConditionInFocus'];
    // Read by the focus tree loader; `?? 'standard'` covers a configuration without the key (the tests' stub).
    readonly focusTreeLayout: Configuration['focusTreeLayout'];
    readonly eventTreePreview: Configuration['eventTreePreview'];
    readonly ideaPreview: Configuration['ideaPreview'];
    readonly decisionPreview: Configuration['decisionPreview'];
    readonly characterPreview: Configuration['characterPreview'];
    readonly ideaSwapIndex: Configuration['ideaSwapIndex'];
    readonly sharedFocusIndex: Configuration['sharedFocusIndex'];
    readonly gfxIndex: Configuration['gfxIndex'];
    readonly localisationIndex: Configuration['localisationIndex'];
    readonly technologyCountryIcons: Configuration['technologyCountryIcons'];
    // Not a feature flag as such, but it is read once per localised string a preview resolves --
    // thousands of times in a single tech tree render -- and building a configuration proxy that
    // often is pure overhead. It lives here because this is what already refreshes on a settings
    // change, so there is no second thing to keep in step.
    readonly previewLocalisation: Configuration['previewLocalisation'];
    // Read once per preview build, in html(), and rendered into the page as window.previewWheel.
    readonly previewWheel: Configuration['previewWheel'];
}

function readFlags(): FeatureFlags {
    const config = getConfiguration();
    return {
        useConditionInFocus: config.useConditionInFocus,
        focusTreeLayout: config.focusTreeLayout ?? 'standard',
        eventTreePreview: config.eventTreePreview,
        ideaPreview: config.ideaPreview,
        decisionPreview: config.decisionPreview,
        characterPreview: config.characterPreview,
        ideaSwapIndex: config.ideaSwapIndex,
        sharedFocusIndex: config.sharedFocusIndex,
        gfxIndex: config.gfxIndex,
        localisationIndex: config.localisationIndex,
        technologyCountryIcons: config.technologyCountryIcons,
        previewLocalisation: config.previewLocalisation,
        previewWheel: config.previewWheel,
    };
}

let flags = readFlags();

export function getFlags(): FeatureFlags {
    return flags;
}

export function refreshFeatureFlags(): void {
    flags = readFlags();
}

export function registerFeatureFlags(): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(ConfigurationKey)) {
            refreshFeatureFlags();
        }
    });
}
