import { JSDOM, VirtualConsole } from 'jsdom';

// Every error the page raised that nobody asked for: an exception a listener threw out to jsdom, or
// one `tryRun` caught and reported as exception telemetry. Both are still printed; a root hook below
// turns whatever is left here into a failed test.
const runtimeErrors: unknown[] = [];

const virtualConsole = new VirtualConsole().forwardTo(console);
virtualConsole.on('jsdomError', (error: any) => {
    if (error.type === 'unhandled-exception') {
        runtimeErrors.push(error.cause ?? error);
    }
});

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
    pretendToBeVisual: true,
    virtualConsole,
});

// global window (no ts-expect-error)
(global as any).window = dom.window;
(global as any).document = dom.window.document;

// Everything the webview posted back to the host, newest last. A test that cares what a click did
// -- whether it asked the editor to navigate, say -- reads this instead of stubbing the api again
// after the module under test has already taken its handle. It is emptied before every test.
export const postedMessages: any[] = [];

// What the page has posted since the test started, without clearing it.
export function recordedPosts(): any[] {
    return postedMessages.slice();
}

export function takePostedMessages(): any[] {
    return postedMessages.splice(0, postedMessages.length);
}

// A root hook: this module is imported from spec files, so mocha's globals exist while it loads.
beforeEach(function () {
    postedMessages.length = 0;
});

// The runtime errors raised since the last call, for a test that triggers one on purpose and asserts
// on it. Taking them is what keeps the root hooks from failing the test over them.
export function takeRuntimeErrors(): unknown[] {
    return runtimeErrors.splice(0, runtimeErrors.length);
}

function describeRuntimeError(error: unknown): string {
    if (error instanceof Error || (error && typeof error === 'object' && 'stack' in error)) {
        return String((error as Error).stack ?? (error as Error).message);
    }
    return typeof error === 'string' ? error : JSON.stringify(error);
}

function failOnRuntimeErrors(where: string): void {
    const errors = takeRuntimeErrors();
    if (errors.length > 0) {
        throw new Error(`Unexpected webview runtime error(s) ${where}:\n${errors.map(describeRuntimeError).join('\n')}`);
    }
}

afterEach(function () {
    failOnRuntimeErrors(`by "${this.currentTest?.fullTitle() ?? 'unknown test'}", its hooks, or anything that ran since the previous test (spec files loading, for the first)`);
});

after(function () {
    failOnRuntimeErrors('while loading the spec files or in the last hooks');
});

// The listeners a webview entrypoint adds to `window` while it loads, held back from the window so
// that one preview never handles another preview's `load` or `message`: every spec file shares this
// one window. A suite that drives the preview through window events attaches them for its duration.
export interface EntrypointListeners {
    attach(): void;
    detach(): void;
}

type RecordedListener = [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined];

export function loadEntrypoint<T>(load: () => T): { module: T; listeners: EntrypointListeners } {
    const recorded: RecordedListener[] = [];
    const originalAddEventListener = window.addEventListener;
    (window as any).addEventListener = (...args: RecordedListener) => {
        recorded.push(args);
    };
    let module: T;
    try {
        module = load();
    } finally {
        (window as any).addEventListener = originalAddEventListener;
    }

    // What the module added while attached -- a listener its load handler registers, say -- is
    // removed with the rest, so nothing it did outlives the suite.
    let attached: RecordedListener[] | undefined;
    const listeners: EntrypointListeners = {
        attach() {
            if (attached) {
                return;
            }
            const added: RecordedListener[] = [];
            attached = added;
            for (const args of recorded) {
                originalAddEventListener.apply(window, args);
                added.push(args);
            }
            (window as any).addEventListener = (...args: RecordedListener) => {
                originalAddEventListener.apply(window, args);
                added.push(args);
            };
        },
        detach() {
            if (!attached) {
                return;
            }
            (window as any).addEventListener = originalAddEventListener;
            for (const [type, listener, options] of attached) {
                window.removeEventListener(type, listener, options);
            }
            attached = undefined;
        },
    };
    return { module: module!, listeners };
}

// Attaches the entrypoint's listeners for the enclosing `describe`.
export function useEntrypoint(listeners: EntrypointListeners): void {
    before(() => listeners.attach());
    after(() => listeners.detach());
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
        if (message?.command === 'telemetry' && message.telemetryType === 'exception') {
            runtimeErrors.push(message.args?.[0] ?? message);
        }
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
