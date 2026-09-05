import { contextContainer } from '../context';

// A preview's toolbar toggles are the reader's preference, not the panel's scroll position. The
// webview's own `vscode.setState` cannot hold them: that state belongs to the panel, and the panel
// is disposed the moment the previewed document closes, so a toggle ticked once was off again the
// next time the preview opened. These live in globalState instead, keyed by the preview that owns
// them ('mio.showGrid'), and are handed to the page as `window.previewOptions` when it is rendered.
//
// The prefix keeps them apart from anything else the extension stores under the same globalState.
const prefix = 'previewOption.';

/**
 * The stored values for `keys`, leaving out every key nothing has been stored for. Omitting them
 * rather than filling in a default is deliberate: the default belongs to the webview that draws the
 * toggle, and duplicating it here would be a second answer to the same question.
 */
export function getPreviewOptions(keys: string[]): Record<string, unknown> {
    const globalState = contextContainer.current?.globalState;
    if (!globalState) {
        return {};
    }

    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const value = globalState.get(prefix + key);
        if (value !== undefined) {
            result[key] = value;
        }
    }

    return result;
}

export function setPreviewOption(key: string, value: unknown): void {
    void contextContainer.current?.globalState.update(prefix + key, value);
}
