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
// icon-resolution pass has to produce. st-inlay-gui-slot- keys are counter-suffixed geometry
// classes embedded in the persistent inlay markup; a count change mints new class names whose
// rules only reach the webview through the icon-CSS repush, so they must move this fingerprint.
const iconKeyPrefixes = ['st-focus-icon-', 'st-focus-titlebar-', 'st-focus-overlay-', 'st-inlay-gfx-', 'st-inlay-gui-slot-'];

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

// Object-level fingerprint input: the parsed focus trees plus the static grid metadata and the config
// that changes the RENDER without changing the FocusTree objects (useConditionInFocus, and the two
// localisation knobs). Used by the partial-update early-out to detect a structural change BEFORE any
// HTML/style rendering, so it is the focusTrees-only subset of computeStructuralFingerprint's hash (no
// rendered/styleTable records). localisationIndex/previewLocalisation are PASSED IN (this module stays
// import-free); folding them here means toggling the localisation index or switching preview language
// moves the hash, so a config flip -- which does NOT reload the preview -- can never be stale-skipped.
export interface FocusTreeObjectStructureInput {
    focusTrees: unknown;
    gridBox: unknown;
    useConditionInFocus: boolean;
    xGridSize: number;
    localisationIndex: boolean;
    previewLocalisation: string;
}

export function computeTreeStructuralFingerprint(input: FocusTreeObjectStructureInput): string {
    // guiWindow is a large HOIPartial subtree resolved from the .gui dependency file. It changes only on
    // a .gui dependency change, which reaches the preview as dependencyChanged (handled by the early-out's
    // !dependencyChanged gate), and any change to WHICH inlay a tree references shows up in the other inlay
    // fields (windowName/guiFile/scriptedImages), so excluding guiWindow shrinks the hash without hiding a
    // structural change. The replacer drops any property named guiWindow at any depth (no other field uses
    // that name) instead of mutating the real focusTrees objects. Focus/inlay tokens are KEPT on purpose: a
    // text shift legitimately moves navigation offsets, matching the rendered start=/end= behavior.
    return JSON.stringify([
        input.focusTrees,
        input.gridBox,
        input.useConditionInFocus,
        input.xGridSize,
        input.localisationIndex,
        input.previewLocalisation,
    ], (key, value) => key === 'guiWindow' ? undefined : value);
}

interface FingerprintFocus {
    icon?: { icon?: string }[];
    textIcon?: string;
    overlay?: string;
}

interface FingerprintTree {
    focuses?: Record<string, FingerprintFocus>;
    inlayWindows?: { scriptedImages?: { gfxOptions?: { gfxName?: string }[] }[] }[];
}

// Object-level analog of computeIconSourceFingerprint: the set of icon identities the render has to
// resolve, taken straight from the parsed trees. Keys are category-prefixed so an icon and an overlay of
// the same name stay distinct, mirroring the st-focus-icon-/st-focus-overlay-/... styleTable prefixes.
export function computeTreeIconFingerprint(focusTrees: FingerprintTree[]): string {
    const keys = new Set<string>();
    for (const tree of focusTrees) {
        for (const focus of Object.values(tree.focuses ?? {})) {
            for (const icon of focus.icon ?? []) {
                if (icon.icon !== undefined) { keys.add('icon:' + icon.icon); }
            }
            if (focus.textIcon !== undefined) { keys.add('titlebar:' + focus.textIcon); }
            if (focus.overlay !== undefined) { keys.add('overlay:' + focus.overlay); }
        }
        for (const inlay of tree.inlayWindows ?? []) {
            for (const slot of inlay.scriptedImages ?? []) {
                for (const option of slot.gfxOptions ?? []) {
                    if (option.gfxName !== undefined) { keys.add('inlay-gfx:' + option.gfxName); }
                }
            }
        }
    }
    return JSON.stringify([...keys].sort());
}
