import * as vscode from 'vscode';
import { previewManager } from './previewdef/previewmanager';
import { registerContextContainer, setVscodeContext } from './context';
import { DDSViewProvider, TGAViewProvider } from './ddsviewprovider';
import { registerModFile } from './util/modfile';
import { worldMap } from './previewdef/worldmap';
import { ViewType, ContextName } from './constants';
import { registerScanReferencesCommand } from './util/dependency';
import { registerHoiFs } from './util/hoifs';
import { loadI18n } from './util/i18n';
import { registerGfxIndex } from './util/gfxindex';
import { Logger } from "./util/logger";
import { registerLocalisationIndex } from "./util/localisationIndex";
import { registerSharedFocusIndex } from "./util/sharedFocusIndex";
import { registerIdeaSwapIndex } from "./util/ideaSwapIndex";
import { registerFeatureFlags } from "./util/featureflags";
import { registerIndexStatusCommand } from "./util/indexBuild";
import { disposeImageDecodeWorkers } from "./util/image/imagedecoder";
import { registerAuditFocusTreesCommand } from "./previewdef/focustree/warningreport";
import { registerModTools } from "./modtools/host";

export function activate(context: vscode.ExtensionContext) {
    let locale: string | undefined = context.extension?.packageJSON?.locale;
    if (locale === "%hoi4modutilities.locale%") {
        locale = 'en';
    }

    context.subscriptions.push(Logger.initialize());

    loadI18n(locale);

    // Must register this first because other component may use it.
    context.subscriptions.push(registerContextContainer(context));
    context.subscriptions.push(registerFeatureFlags());

    context.subscriptions.push(previewManager.register());
    context.subscriptions.push(registerModFile());
    context.subscriptions.push(worldMap.register());
    context.subscriptions.push(registerScanReferencesCommand());
    context.subscriptions.push(registerHoiFs());
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(ViewType.DDS, new DDSViewProvider()));
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(ViewType.TGA, new TGAViewProvider()));
    context.subscriptions.push(registerSharedFocusIndex());
    context.subscriptions.push(registerGfxIndex());
    context.subscriptions.push(registerLocalisationIndex());
    context.subscriptions.push(registerIdeaSwapIndex());
    context.subscriptions.push(registerIndexStatusCommand());
    context.subscriptions.push(registerAuditFocusTreesCommand());
    context.subscriptions.push({ dispose: disposeImageDecodeWorkers });

    setVscodeContext(ContextName.Hoi4MULoaded, true);

    // Last, and after the extension counts as loaded: mod tools are maintained by the mods, and
    // nothing they do may keep the standard utilities from starting.
    context.subscriptions.push(registerModTools());
}

export function deactivate() {}
