// Unit-test setup: stub out the `vscode` module so pure-function tests can
// load source files that import it.
//
// Source files under src/util and src/previewdef routinely do
// `import * as vscode from 'vscode';` at the top, which compiles to
// `const vscode = require('vscode')` under commonjs. The real vscode module
// only exists inside the extension host, so mocha + plain Node would throw
// MODULE_NOT_FOUND the moment any test transitively requires such a source
// file.
//
// This setup file is wired into the mocha invocation through the `--require`
// flag in the npm test script. It runs before any test file is loaded.

const Module = require('module');
const path = require('path');

function buildStub() {
    function noop() { return undefined; }
    function disposable() { return { dispose: noop }; }

    const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

    const Uri = {
        file(p: string) {
            const fsPath = String(p);
            return { fsPath, path: '/' + fsPath.replace(/\\/g, '/'), scheme: 'file', toString: () => 'file://' + fsPath };
        },
        parse(v: string) {
            return { fsPath: v, path: v, scheme: 'file', toString: () => v };
        },
        joinPath(base: any, ...pathSegments: string[]) {
            const basePath = (base && base.fsPath) || '';
            const fsPath = [basePath, ...pathSegments].join('/').replace(/\\/g, '/');
            return { fsPath, path: '/' + fsPath, scheme: 'file', toString: () => 'file://' + fsPath };
        },
    };

    const workspace = {
        getConfiguration: () => ({
            get: (_k: any) => undefined,
            update: () => Promise.resolve(),
            inspect: () => undefined,
        }),
        workspaceFolders: undefined,
        getWorkspaceFolder: () => undefined,
        onDidChangeConfiguration: disposable,
        onDidChangeTextDocument: disposable,
        onDidCloseTextDocument: disposable,
        onDidChangeWorkspaceFolders: disposable,
        onDidCreateFiles: disposable,
        onDidDeleteFiles: disposable,
        onDidRenameFiles: disposable,
        textDocuments: [],
        openTextDocument: async () => undefined,
        registerTextDocumentContentProvider: () => disposable(),
        fs: {
            stat: async () => ({ type: FileType.File, mtime: 0, ctime: 0, size: 0 }),
            readDirectory: async () => [],
            readFile: async () => new Uint8Array(),
            writeFile: async () => undefined,
            createDirectory: async () => undefined,
        },
    };

    function webviewPanel(options: any) {
        let html = '';
        const webview = {
            get html() { return html; },
            set html(v: string) { html = v; },
            options: options ?? {},
            cspSource: 'stub-csp-source',
            asWebviewUri: (uri: any) => uri,
            postMessage: async (_msg: any) => true,
            onDidReceiveMessage: () => disposable(),
        };
        return {
            webview,
            options: options ?? {},
            viewColumn: undefined,
            visible: true,
            active: true,
            iconPath: undefined,
            onDidDispose: () => disposable(),
            onDidChangeViewState: () => disposable(),
            reveal: noop,
            dispose: noop,
        };
    }

    const window = {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showQuickPick: async () => undefined,
        showOpenDialog: async () => undefined,
        setStatusBarMessage: () => disposable(),
        createStatusBarItem: () => ({
            text: '', tooltip: '', command: undefined,
            show: noop, hide: noop, dispose: noop,
        }),
        activeTextEditor: undefined,
        visibleTextEditors: [],
        onDidChangeActiveTextEditor: disposable,
        createWebviewPanel: (_viewType: string, _title: string, _showOptions: any, options: any) => webviewPanel(options),
        registerWebviewPanelSerializer: () => disposable(),
        registerCustomEditorProvider: () => disposable(),
    };

    const commands = {
        registerCommand: () => disposable(),
        executeCommand: async () => undefined,
    };

    const ConfigurationTarget = { Global: 1, Workspace: 2 };
    const StatusBarAlignment = { Left: 1, Right: 2 };
    const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };

    function Position(this: any, line: number, character: number) { this.line = line; this.character = character; }
    function Range(this: any, s: any, e: any) { this.start = s; this.end = e; }

    return {
        Uri,
        workspace,
        window,
        commands,
        env: {},
        FileType,
        ConfigurationTarget,
        StatusBarAlignment,
        ViewColumn,
        Position,
        Range,
        Disposable: { from: (...d: any[]) => ({ dispose: () => d.forEach(x => x && x.dispose && x.dispose()) }) },
        EventEmitter: class { event: any; fire: any; dispose: any; constructor() { this.event = () => undefined; this.fire = noop; this.dispose = noop; } },
        TreeItem: class { label: any; constructor(label: any) { this.label = label; } },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class { id: any; constructor(id: any) { this.id = id; } },
    };
}

const assetStubPath = path.join(__dirname, '__asset_stub__');

const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, parent: any, ...rest: any[]) {
    if (request === 'vscode') {
        return path.join(__dirname, '__vscode_stub__');
    }
    // webpack's raw-loader inlines *.html/*.css as strings at build time; under tsc + Node those
    // files aren't copied next to the compiled output, so requiring them for real would 404. Modules
    // pulling one in (e.g. worldmap.ts) only need the import to resolve, not real content.
    if (request.endsWith('.html') || request.endsWith('.css')) {
        return assetStubPath;
    }
    return origResolve.call(this, request, parent, ...rest);
};

// `def.d.ts` declares a handful of compile-time globals (IS_WEB_EXT, VERSION,
// EXTENSION_ID). The webpack build wires these up via DefinePlugin; under
// Node + tsc they are undefined. Tests that load modules referencing them
// (e.g. fileloader.ts) need them set on globalThis.
(globalThis as any).IS_WEB_EXT = false;
(globalThis as any).VERSION = 'test';
(globalThis as any).EXTENSION_ID = 'test.test';

const stub = buildStub();
(require.cache as any)[path.join(__dirname, '__vscode_stub__')] = {
    id: 'vscode',
    filename: 'vscode',
    loaded: true,
    exports: stub,
    children: [],
    paths: [],
};

// `__esModule: true` makes TS's `__importDefault` helper hand back `.default` as-is instead of
// wrapping this whole object as the default, so `import x from './y.html'` sees the string.
(require.cache as any)[assetStubPath] = {
    id: 'asset-stub',
    filename: 'asset-stub',
    loaded: true,
    exports: { __esModule: true, default: '' },
    children: [],
    paths: [],
};

// The stub above is deliberately inert: every accessor returns nothing. Suites that need real
// behaviour (a config value, a directory listing, a fixed clock) replace those members for the
// duration of a test and must put them back afterwards, or the replacement leaks into every suite
// that runs later. That save-and-restore used to be hand-rolled per `describe`, which meant two
// naming conventions, a member occasionally forgotten in the restore, and -- because the "original"
// was captured while the `describe` body was evaluated -- a capture that would snapshot another
// suite's stub rather than the pristine one if a leak ever happened.
//
// `stubVscode` / `restoreVscodeStubs` below replace that idiom. The pristine values are captured
// here, at module load, straight from `buildStub()`'s output, so they cannot be anything but
// pristine; `restoreVscodeStubs` puts all of them back unconditionally, so a suite cannot forget
// one. This file is the natural home for them: it is `--require`d by the mocha invocation (see the
// `test` script in package.json), so it is always loaded, and always loaded first.
const pristine = {
    getConfiguration: stub.workspace.getConfiguration,
    workspaceFolders: stub.workspace.workspaceFolders as unknown,
    onDidChangeConfiguration: stub.workspace.onDidChangeConfiguration,
    stat: stub.workspace.fs.stat,
    readDirectory: stub.workspace.fs.readDirectory,
    readFile: stub.workspace.fs.readFile,
    openTextDocument: stub.workspace.openTextDocument,
    textDocuments: stub.workspace.textDocuments as unknown,
    showErrorMessage: stub.window.showErrorMessage,
    createWebviewPanel: stub.window.createWebviewPanel,
    registerWebviewPanelSerializer: stub.window.registerWebviewPanelSerializer,
    now: Date.now,
};

export interface VscodeStubOverrides {
    /**
     * Convenience for the common case: installs a `getConfiguration` returning the stub's default
     * `get`/`update`/`inspect` shape with these properties merged on top. Suites that need the
     * returned config to change between assertions should stub `getConfiguration` directly with a
     * closure over a mutable object instead.
     */
    configuration?: Record<string, unknown>;
    getConfiguration?: () => any;
    workspaceFolders?: unknown;
    onDidChangeConfiguration?: (handler: any) => { dispose(): void };
    stat?: (uri: any) => Promise<any>;
    readDirectory?: (uri: any) => Promise<[string, number][]>;
    readFile?: (uri: any) => Promise<Uint8Array>;
    openTextDocument?: (uri: any) => Promise<any>;
    /** Replaces `workspace.textDocuments`, for suites driving `getDocumentByUri` lookups. */
    textDocuments?: readonly any[];
    showErrorMessage?: (...args: any[]) => Promise<any>;
    createWebviewPanel?: (viewType: string, title: string, showOptions: any, options: any) => any;
    /** Captures the serializer a suite's `register()` call installs, e.g. to drive it directly. */
    registerWebviewPanelSerializer?: (viewType: string, serializer: any) => { dispose(): void };
    /** Replaces `Date.now`, for suites driving a TTL boundary deterministically. */
    now?: () => number;
}

/**
 * Replaces the stubbed vscode members named in `overrides`; members left out keep whatever they
 * currently have. Safe to call more than once per test (e.g. to vary `stat` inside a single `it`).
 * Always pair with `restoreVscodeStubs` in an `afterEach`.
 */
export function stubVscode(overrides: VscodeStubOverrides): void {
    const workspace = stub.workspace as any;
    const fs = stub.workspace.fs as any;
    const window = stub.window as any;

    if (overrides.configuration !== undefined) {
        const configuration = {
            get: (_k: any) => undefined,
            update: () => Promise.resolve(),
            inspect: () => undefined,
            ...overrides.configuration,
        };
        workspace.getConfiguration = () => configuration;
    }
    if (overrides.getConfiguration !== undefined) {
        workspace.getConfiguration = overrides.getConfiguration;
    }
    if ('workspaceFolders' in overrides) {
        workspace.workspaceFolders = overrides.workspaceFolders;
    }
    if (overrides.onDidChangeConfiguration !== undefined) {
        workspace.onDidChangeConfiguration = overrides.onDidChangeConfiguration;
    }
    if (overrides.stat !== undefined) {
        fs.stat = overrides.stat;
    }
    if (overrides.readDirectory !== undefined) {
        fs.readDirectory = overrides.readDirectory;
    }
    if (overrides.readFile !== undefined) {
        fs.readFile = overrides.readFile;
    }
    if (overrides.openTextDocument !== undefined) {
        workspace.openTextDocument = overrides.openTextDocument;
    }
    if (overrides.textDocuments !== undefined) {
        workspace.textDocuments = overrides.textDocuments;
    }
    if (overrides.showErrorMessage !== undefined) {
        window.showErrorMessage = overrides.showErrorMessage;
    }
    if (overrides.createWebviewPanel !== undefined) {
        window.createWebviewPanel = overrides.createWebviewPanel;
    }
    if (overrides.registerWebviewPanelSerializer !== undefined) {
        window.registerWebviewPanelSerializer = overrides.registerWebviewPanelSerializer;
    }
    if (overrides.now !== undefined) {
        Date.now = overrides.now;
    }
}

/** Puts every stubbable member back to the value `buildStub()` produced. */
export function restoreVscodeStubs(): void {
    const workspace = stub.workspace as any;
    const fs = stub.workspace.fs as any;
    const window = stub.window as any;

    workspace.getConfiguration = pristine.getConfiguration;
    workspace.workspaceFolders = pristine.workspaceFolders;
    workspace.onDidChangeConfiguration = pristine.onDidChangeConfiguration;
    fs.stat = pristine.stat;
    fs.readDirectory = pristine.readDirectory;
    fs.readFile = pristine.readFile;
    workspace.openTextDocument = pristine.openTextDocument;
    workspace.textDocuments = pristine.textDocuments;
    window.showErrorMessage = pristine.showErrorMessage;
    window.createWebviewPanel = pristine.createWebviewPanel;
    window.registerWebviewPanelSerializer = pristine.registerWebviewPanelSerializer;
    Date.now = pristine.now;
}
