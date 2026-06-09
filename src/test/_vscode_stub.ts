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
        joinPath(base: any) {
            const fsPath = (base && base.fsPath) || '';
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
        fs: {
            stat: async () => ({ type: FileType.File, mtime: 0, ctime: 0, size: 0 }),
            readDirectory: async () => [],
            readFile: async () => new Uint8Array(),
            writeFile: async () => undefined,
            createDirectory: async () => undefined,
        },
    };

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
    };

    const commands = {
        registerCommand: () => disposable(),
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

const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, parent: any, ...rest: any[]) {
    if (request === 'vscode') {
        return path.join(__dirname, '__vscode_stub__');
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
