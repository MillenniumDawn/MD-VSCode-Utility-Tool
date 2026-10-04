import * as assert from 'assert';
import * as vscode from 'vscode';
import { ModTool, ModToolPack } from '../modtools/api';
import {
    AvailableModTool, ModToolHostEnvironment, findAvailableModTools, pickItems, registerModTools, runModTool,
} from '../modtools/host';
import { contextContainer } from '../context';
import { ContextName, Commands } from '../constants';
import { restoreVscodeStubs, stubVscode } from './_vscode_stub';

// Mod tools are maintained by the mods, so the host's job is to keep them from reaching the rest of
// the extension: nothing runs while they are off, a pack that throws costs only its own tools, and a
// tool that fails ends in a message that sends the reader to the mod, not to this extension.

function tool(id: string, overrides: Partial<ModTool> = {}): ModTool {
    return { id, title: `Tool ${id}`, run: async () => undefined, ...overrides };
}

function pack(id: string, tools: ModTool[], files = [`${id}.marker`]): ModToolPack {
    return {
        id,
        displayName: `Mod ${id}`,
        maintainer: { name: `The ${id} team`, issues: `https://example.com/${id}/issues` },
        detect: { files },
        tools,
    };
}

const root = vscode.Uri.file('/mod');

function environment(overrides: Partial<ModToolHostEnvironment> = {}, present: string[] = []): ModToolHostEnvironment {
    return {
        enabled: () => true,
        toolEnabled: () => true,
        isWeb: false,
        isTrusted: () => true,
        folders: () => [root],
        exists: async uri => present.some(file => uri.fsPath.replace(/\\/g, '/').endsWith('/' + file)),
        ...overrides,
    };
}

const ids = (available: AvailableModTool[]) => available.map(a => `${a.pack.id}.${a.tool.id}`);

describe('modtools/host', () => {
    afterEach(() => restoreVscodeStubs());

    describe('findAvailableModTools', () => {
        it('looks at nothing while the master switch is off', async () => {
            let looked = false;
            const env = environment({ enabled: () => false, exists: async () => { looked = true; return true; } });
            assert.deepStrictEqual(await findAvailableModTools([pack('a', [tool('x')])], env), []);
            assert.strictEqual(looked, false);
        });

        it('lists the tools of a pack whose mod is open, with the folder it was found in', async () => {
            const available = await findAvailableModTools([pack('a', [tool('x'), tool('y')])], environment({}, ['a.marker']));
            assert.deepStrictEqual(ids(available), ['a.x', 'a.y']);
            assert.strictEqual(available[0]!.modRoot, root);
        });

        it('needs every detect file, and leaves out a pack whose mod is not open', async () => {
            const packs = [pack('a', [tool('x')], ['one', 'two']), pack('b', [tool('x')])];
            assert.deepStrictEqual(ids(await findAvailableModTools(packs, environment({}, ['one']))), []);
            assert.deepStrictEqual(ids(await findAvailableModTools(packs, environment({}, ['one', 'two']))), ['a.x']);
        });

        it('leaves out a tool switched off, a desktop tool on the web and a trusted tool in an untrusted workspace', async () => {
            const packs = [pack('a', [
                tool('off'),
                tool('desktop', { desktopOnly: true }),
                tool('trust', { requiresTrust: true }),
                tool('plain'),
            ])];
            const env = environment({
                toolEnabled: (_p, t) => t.id !== 'off',
                isWeb: true,
                isTrusted: () => false,
            }, ['a.marker']);
            assert.deepStrictEqual(ids(await findAvailableModTools(packs, env)), ['a.plain']);
        });

        it('skips a pack that throws and still lists the others', async () => {
            const broken = pack('broken', [tool('x')]);
            const env = environment({
                exists: async uri => {
                    if (uri.fsPath.includes('broken')) {
                        throw new Error('boom');
                    }
                    return uri.fsPath.endsWith('ok.marker');
                },
            });
            assert.deepStrictEqual(ids(await findAvailableModTools([broken, pack('ok', [tool('x')])], env)), ['ok.x']);
        });
    });

    describe('runModTool', () => {
        it('hands the tool its mod root', async () => {
            let seen: vscode.Uri | undefined;
            const p = pack('a', [tool('x', { run: async ctx => { seen = ctx.modRoot; } })]);
            await runModTool({ pack: p, tool: p.tools[0]!, modRoot: root });
            assert.strictEqual(seen, root);
        });

        it('turns a failure into a message naming the maintainer, and opens their tracker on request', async () => {
            const messages: string[] = [];
            const opened: string[] = [];
            stubVscode({
                showErrorMessage: async (message: string, ...buttons: string[]) => { messages.push(message); return buttons[0]; },
                openExternal: async (uri: vscode.Uri) => { opened.push(uri.toString()); return true; },
            });
            const p = pack('a', [tool('x', { run: async () => { throw new Error('no python'); } })]);

            await runModTool({ pack: p, tool: p.tools[0]!, modRoot: root });

            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0]!.includes('no python'), messages[0]);
            assert.ok(messages[0]!.includes('The a team'), messages[0]);
            assert.deepStrictEqual(opened, ['https://example.com/a/issues']);
        });
    });

    describe('pickItems', () => {
        it('puts each mod under a separator of its own', () => {
            const a = pack('a', [tool('x'), tool('y')]);
            const b = pack('b', [tool('z')]);
            const items = pickItems([
                { pack: a, tool: a.tools[0]!, modRoot: root },
                { pack: a, tool: a.tools[1]!, modRoot: root },
                { pack: b, tool: b.tools[0]!, modRoot: root },
            ]);
            assert.deepStrictEqual(items.map(i => [i.label, i.kind === vscode.QuickPickItemKind.Separator]), [
                ['Mod a', true], ['Tool x', false], ['Tool y', false], ['Mod b', true], ['Tool z', false],
            ]);
        });
    });

    describe('registerModTools', () => {
        async function settle(): Promise<void> {
            for (let i = 0; i < 5; i++) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        it('runs the picked tool and marks the command available', async () => {
            let handler: (() => Promise<void>) | undefined;
            let ran = false;
            stubVscode({
                registerCommand: (command, h) => {
                    if (command === Commands.RunModTool) {
                        handler = h;
                    }
                    return { dispose: () => undefined };
                },
                showQuickPick: async (items: { available?: unknown }[]) => items.find(i => i.available),
            });
            const disposable = registerModTools([pack('a', [tool('x', { run: async () => { ran = true; } })])], environment({}, ['a.marker']));
            await settle();

            assert.strictEqual(contextContainer.contextValue[ContextName.ModToolsAvailable], true);
            await handler!();
            assert.strictEqual(ran, true);
            disposable.dispose();
        });

        it('says what to do when nothing is available, and marks the command unavailable', async () => {
            let handler: (() => Promise<void>) | undefined;
            const infos: string[] = [];
            stubVscode({
                registerCommand: (_command, h) => { handler = h; return { dispose: () => undefined }; },
                showInformationMessage: async (message: string) => { infos.push(message); return undefined; },
            });
            registerModTools([pack('a', [tool('x')])], environment({ enabled: () => false })).dispose();
            await settle();

            assert.strictEqual(contextContainer.contextValue[ContextName.ModToolsAvailable], false);
            await handler!();
            assert.strictEqual(infos.length, 1);
        });

        it('does not throw when it cannot be set up', () => {
            stubVscode({ registerCommand: () => { throw new Error('boom'); } });
            assert.doesNotThrow(() => registerModTools([], environment()).dispose());
        });
    });
});
