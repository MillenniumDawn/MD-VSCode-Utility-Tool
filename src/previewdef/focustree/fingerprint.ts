// Pure fingerprint / skip-decision helpers for the focus-tree preview's partial-update path.
// Import-free on purpose so unit tests can exercise them without pulling in the vscode-dependent
// preview modules.

export interface FocusTreeStructureInput {
    focusTrees: unknown;
    renderedFocus: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
    gridBox: unknown;
    useConditionInFocus: boolean;
    xGridSize: number;
    // Structure-only styleTable records: placeholder focus icons plus the (deterministic per
    // identity) titlebar/overlay/inlay sprite CSS and the structural styles.
    styleRecords: Record<string, string>;
}

// styleTable keys whose identity (not the resolved image bytes) decides what the expensive
// icon-resolution pass has to produce.
const iconKeyPrefixes = ['st-focus-icon-', 'st-focus-titlebar-', 'st-focus-overlay-', 'st-inlay-gfx-'];

// Serialize a record with its keys in sorted order so insertion order (which varies under the
// 8-way concurrent render) does not change the fingerprint.
function sortedRecordEntries(record: Record<string, string>): [string, string][] {
    return Object.keys(record).sort().map(k => [k, record[k]] as [string, string]);
}

export function computeStructuralFingerprint(input: FocusTreeStructureInput): string {
    return JSON.stringify([
        input.focusTrees,
        sortedRecordEntries(input.renderedFocus),
        sortedRecordEntries(input.renderedInlayWindows),
        input.gridBox,
        input.useConditionInFocus,
        input.xGridSize,
        sortedRecordEntries(input.styleRecords),
    ]);
}

export function computeIconSourceFingerprint(styleRecords: Record<string, string>): string {
    const keys = Object.keys(styleRecords).filter(k => iconKeyPrefixes.some(p => k.startsWith(p)));
    keys.sort();
    return JSON.stringify(keys);
}

export interface FocusTreeFingerprints {
    structural: string;
    iconSource: string;
}

export interface FocusTreeUpdateDecision {
    postUpdate: boolean;
    pushIcons: boolean;
}

/**
 * Decides what the webview needs given the previous and current fingerprints. `postUpdate` rebuilds
 * the focus DOM; `pushIcons` re-resolves and re-pushes the real icon CSS. Both false means nothing
 * the webview renders changed, so the update can be skipped entirely (the common while-typing case).
 */
export function decideFocusTreeUpdate(prev: FocusTreeFingerprints | undefined, next: FocusTreeFingerprints): FocusTreeUpdateDecision {
    if (prev === undefined) {
        return { postUpdate: true, pushIcons: true };
    }
    return {
        postUpdate: next.structural !== prev.structural,
        pushIcons: next.iconSource !== prev.iconSource,
    };
}
