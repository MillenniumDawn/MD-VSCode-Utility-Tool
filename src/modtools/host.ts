import * as vscode from 'vscode';
import { Commands, ConfigurationKey, ContextName } from '../constants';
import { setVscodeContext } from '../context';
import { localize } from '../util/i18n';
import { Logger } from '../util/logger';
import { getConfiguration } from '../util/vsccommon';
import { ModTool, ModToolPack } from './api';
import { modToolPacks } from './registry';

// Hosts the mod packs in registry.ts, kept apart from everything else the extension does: this is
// the only module outside src/modtools/ that is imported (by extension.ts alone), nothing here can
// throw out of registration, and every call into a pack -- finding its mod, running a tool -- is
// guarded on its own, so a broken pack costs its own tools and nothing more.

const modToolsSection = `${ConfigurationKey}.modTools`;

export interface ModToolHostEnvironment {
    /** The master switch, `modTools.enabled`. */
    enabled(): boolean;
    /** A tool's own switch, `modTools.<pack>.<tool>`. */
    toolEnabled(pack: ModToolPack, tool: ModTool): boolean;
    isWeb: boolean;
    isTrusted(): boolean;
    folders(): readonly vscode.Uri[];
    exists(uri: vscode.Uri): Promise<boolean>;
}

export interface AvailableModTool {
    readonly pack: ModToolPack;
    readonly tool: ModTool;
    readonly modRoot: vscode.Uri;
}

function toolSettingKey(pack: ModToolPack, tool: ModTool): string {
    return `modTools.${pack.id}.${tool.id}`;
}

function log(pack: ModToolPack, message: string): void {
    Logger.info(`[Mod tools] ${pack.displayName}: ${message}`);
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

async function findModRoot(pack: ModToolPack, env: ModToolHostEnvironment): Promise<vscode.Uri | undefined> {
    for (const folder of env.folders()) {
        const found = await Promise.all(pack.detect.files.map(file => env.exists(vscode.Uri.joinPath(folder, file))));
        if (found.length > 0 && found.every(Boolean)) {
            return folder;
        }
    }
    return undefined;
}

/**
 * The tools that can run in this workspace right now: the master switch is on, the pack's mod is
 * open, and the tool is switched on and allowed here (desktop, trust). A pack that throws while
 * being looked at is logged and left out; the others are still listed.
 */
export async function findAvailableModTools(
    packs: readonly ModToolPack[], env: ModToolHostEnvironment,
): Promise<AvailableModTool[]> {
    if (!env.enabled()) {
        return [];
    }
    const result: AvailableModTool[] = [];
    for (const pack of packs) {
        try {
            const tools = pack.tools.filter(tool =>
                env.toolEnabled(pack, tool)
                && !(tool.desktopOnly && env.isWeb)
                && !(tool.requiresTrust && !env.isTrusted()));
            if (tools.length === 0) {
                continue;
            }
            const modRoot = await findModRoot(pack, env);
            if (modRoot) {
                result.push(...tools.map(tool => ({ pack, tool, modRoot })));
            }
        } catch (e) {
            Logger.error(`[Mod tools] ${pack.displayName} could not be loaded and is skipped: ${messageOf(e)}`);
        }
    }
    return result;
}

/**
 * Runs one tool. Whatever it throws ends here, as a message that names the mod team maintaining it
 * and offers their issue tracker -- this extension does not support mod tools.
 */
export async function runModTool({ pack, tool, modRoot }: AvailableModTool): Promise<void> {
    try {
        await tool.run({ modRoot, log: message => log(pack, message) });
    } catch (e) {
        Logger.error(`[Mod tools] ${pack.displayName} / ${tool.title} failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        const report = localize('modtools.report', 'Report to {0}', pack.maintainer.name);
        const choice = await vscode.window.showErrorMessage(
            localize('modtools.failed',
                'Mod tool "{0}" failed: {1}. This tool is maintained by {2}, not by MD Utilities; please report it to them.',
                tool.title, messageOf(e), pack.maintainer.name),
            report,
        );
        if (choice === report) {
            await vscode.env.openExternal(vscode.Uri.parse(pack.maintainer.issues));
        }
    }
}

type ModToolPickItem = vscode.QuickPickItem & { available?: AvailableModTool };

export function pickItems(available: readonly AvailableModTool[]): ModToolPickItem[] {
    const items: ModToolPickItem[] = [];
    let lastPack: ModToolPack | undefined;
    for (const entry of available) {
        if (entry.pack !== lastPack) {
            items.push({ label: entry.pack.displayName, kind: vscode.QuickPickItemKind.Separator });
            lastPack = entry.pack;
        }
        items.push({ label: entry.tool.title, description: entry.tool.description, available: entry });
    }
    return items;
}

function vscodeEnvironment(): ModToolHostEnvironment {
    return {
        enabled: () => getConfiguration().get<boolean>('modTools.enabled', false) === true,
        toolEnabled: (pack, tool) => getConfiguration().get<boolean>(toolSettingKey(pack, tool), true) !== false,
        isWeb: IS_WEB_EXT,
        isTrusted: () => vscode.workspace.isTrusted,
        folders: () => (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri),
        exists: async uri => {
            try {
                await vscode.workspace.fs.stat(uri);
                return true;
            } catch {
                return false;
            }
        },
    };
}

/**
 * Registers the Run Mod Tool command and keeps `mdHoi4ModToolsAvailable` current. Never throws:
 * if the mod tools cannot even be set up, the rest of the extension carries on without them.
 */
export function registerModTools(
    packs: readonly ModToolPack[] = modToolPacks,
    env: ModToolHostEnvironment = vscodeEnvironment(),
): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    try {
        let generation = 0;
        const refresh = async () => {
            const current = ++generation;
            let available = false;
            try {
                available = (await findAvailableModTools(packs, env)).length > 0;
            } catch (e) {
                Logger.error(`[Mod tools] ${messageOf(e)}`);
            }
            if (current === generation) {
                setVscodeContext(ContextName.ModToolsAvailable, available);
            }
        };

        disposables.push(vscode.commands.registerCommand(Commands.RunModTool, async () => {
            const available = await findAvailableModTools(packs, env);
            if (available.length === 0) {
                await vscode.window.showInformationMessage(localize('modtools.none',
                    'No mod tools are available here. Switch them on under Settings > Mod tools, and open the mod they belong to.'));
                return;
            }
            const picked = await vscode.window.showQuickPick(pickItems(available), {
                placeHolder: localize('modtools.pick', 'Choose a mod tool. Mod tools are maintained by their mods, not by MD Utilities.'),
            });
            if (picked?.available) {
                await runModTool(picked.available);
            }
        }));
        disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(modToolsSection)) {
                void refresh();
            }
        }));
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()));
        disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => void refresh()));
        void refresh();
    } catch (e) {
        Logger.error(`[Mod tools] could not be set up: ${messageOf(e)}`);
    }
    return vscode.Disposable.from(...disposables);
}
