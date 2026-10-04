import * as vscode from 'vscode';

// The contract between the extension and a mod's own tools. A pack is written and maintained by the
// mod it belongs to, not by this extension: see README.md in this folder for what a pack has to meet
// before it is accepted, and why a broken one is removed rather than fixed here.

export interface ModToolPack {
    /** camelCase. Also the middle of every setting key: `mdHoi4Utilities.modTools.<id>.<toolId>`. */
    readonly id: string;
    /** The mod's name, as shown in the Run Mod Tool picker and in error messages. */
    readonly displayName: string;
    /** Who answers for this pack, named whenever one of its tools fails. */
    readonly maintainer: ModToolMaintainer;
    /**
     * How the host recognises the mod: a workspace folder that has every one of these files, as
     * paths relative to the folder, is the mod's root. Pick files only this mod has.
     */
    readonly detect: { readonly files: readonly string[] };
    readonly tools: readonly ModTool[];
}

interface ModToolMaintainer {
    /** The mod team, e.g. "The <mod> team". */
    readonly name: string;
    /** An https:// link to where problems with the pack are reported. */
    readonly issues: string;
}

export interface ModTool {
    /** camelCase. The last part of the tool's setting key. */
    readonly id: string;
    /** Shown in the picker. Localised with `localize`. */
    readonly title: string;
    readonly description?: string;
    /** Needs Node (a child process, the file system outside VS Code's): hidden on the web build. */
    readonly desktopOnly?: boolean;
    /** Runs or reads something from the workspace: hidden until the workspace is trusted. */
    readonly requiresTrust?: boolean;
    run(context: ModToolContext): Promise<void>;
}

interface ModToolContext {
    /** The workspace folder the pack's `detect` files were found in. */
    readonly modRoot: vscode.Uri;
    /** Writes to the extension's output channel, prefixed with the pack's name. */
    log(message: string): void;
}
