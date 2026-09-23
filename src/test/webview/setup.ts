import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
    pretendToBeVisual: true,
});

// global window (no ts-expect-error)
(global as any).window = dom.window;
(global as any).document = dom.window.document;

// Everything the webview posted back to the host, newest last. A test that cares what a click did
// -- whether it asked the editor to navigate, say -- reads and clears this instead of stubbing the
// api again after the module under test has already taken its handle.
export const postedMessages: any[] = [];

export function takePostedMessages(): any[] {
    return postedMessages.splice(0, postedMessages.length);
}

// Mock acquireVsCodeApi for webview tests. The real `setState` replaces the persisted state
// wholesale, so this one does too. The object lives for the whole mocha run, so a test that needs
// a clean slate calls `resetWebviewState()` rather than relying on an earlier file to clear it.
const state: Record<string, any> = {};

export function resetWebviewState(): void {
    for (const key of Object.keys(state)) {
        delete state[key];
    }
}

(global as any).acquireVsCodeApi = () => ({
    postMessage: (message: any) => {
        postedMessages.push(message);
    },
    getState: () => state,
    setState: (s: Record<string, any>) => {
        // Copied first: the webview's own setState hands back the object getState returned.
        const next = { ...s };
        resetWebviewState();
        Object.assign(state, next);
    },
    // end of acquireVsCodeApi mock (no ts-expect-error)
});

// Provide browser globals that jsdom exposes on its window so that
// `new Event(...)`, `new MouseEvent(...)`, `new KeyboardEvent(...)` etc.
// work in test code the same way they do in a real browser.
for (const name of [
    'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent',
    'PointerEvent', 'WheelEvent',
]) {
    (global as any)[name] = (dom.window as any)[name];
}

// jsdom has no 2d canvas: getContext("2d") returns null. Every canvas here gets a recording
// context instead, one per canvas, so a test can assert what was drawn, in order.
export interface CanvasCall {
    method: string;
    args: unknown[];
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    font: string;
    imageSmoothingEnabled: boolean;
}

const recordedCanvasMethods = [
    'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill',
    'fillText', 'drawImage', 'putImageData', 'save', 'restore',
];

export function recordingCanvasContext(): { canvasContext: any; calls: CanvasCall[] } {
    const calls: CanvasCall[] = [];
    const canvasContext: any = {
        fillStyle: '',
        strokeStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        lineWidth: 0,
        globalAlpha: 1,
        imageSmoothingEnabled: true,
        measureText: () => ({ width: 0 }),
        createImageData: (width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
        }),
    };
    for (const method of recordedCanvasMethods) {
        canvasContext[method] = (...args: unknown[]) => {
            calls.push({
                method,
                args,
                fillStyle: canvasContext.fillStyle,
                strokeStyle: canvasContext.strokeStyle,
                lineWidth: canvasContext.lineWidth,
                font: canvasContext.font,
                imageSmoothingEnabled: canvasContext.imageSmoothingEnabled,
            });
        };
    }
    return { canvasContext, calls };
}

const canvasContexts = new WeakMap<object, { canvasContext: any; calls: CanvasCall[] }>();

(dom.window as any).HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') {
        return null;
    }
    let recording = canvasContexts.get(this);
    if (!recording) {
        recording = recordingCanvasContext();
        recording.canvasContext.canvas = this;
        canvasContexts.set(this, recording);
    }
    return recording.canvasContext;
};

// What was drawn on this canvas so far, oldest first.
export function canvasCalls(canvas: HTMLCanvasElement): CanvasCall[] {
    return canvasContexts.get(canvas)?.calls ?? [];
}

export function takeCanvasCalls(canvas: HTMLCanvasElement): CanvasCall[] {
    const calls = canvasContexts.get(canvas)?.calls;
    return calls ? calls.splice(0, calls.length) : [];
}

// Mock i18n table for feLocalize tests
(dom.window as any).__i18ntable = {
    'test.key': 'Translated value',
    'combobox.noselection': '(No selection)',
    'combobox.all': '(All)',
    'combobox.multiple': '{0} (+{1})',
};
