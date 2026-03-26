"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const previewmanager_1 = require("./previewdef/previewmanager");
const context_1 = require("./context");
const ddsviewprovider_1 = require("./ddsviewprovider");
const modfile_1 = require("./util/modfile");
const worldmap_1 = require("./previewdef/worldmap");
const constants_1 = require("./constants");
const telemetry_1 = require("./util/telemetry");
const dependency_1 = require("./util/dependency");
const hoifs_1 = require("./util/hoifs");
const i18n_1 = require("./util/i18n");
const gfxindex_1 = require("./util/gfxindex");
const logger_1 = require("./util/logger");
const localisationIndex_1 = require("./util/localisationIndex");
const sharedFocusIndex_1 = require("./util/sharedFocusIndex");
function activate(context) {
    var _a;
    let locale = (_a = context.extension) === null || _a === void 0 ? void 0 : _a.packageJSON.locale;
    if (locale === "%hoi4modutilities.locale%") {
        locale = 'en';
    }
    logger_1.Logger.initialize();
    logger_1.Logger.show();
    (0, i18n_1.loadI18n)(locale);
    // Must register this first because other component may use it.
    context.subscriptions.push((0, context_1.registerContextContainer)(context));
    context.subscriptions.push((0, telemetry_1.registerTelemetryReporter)());
    (0, telemetry_1.sendEvent)('extension.activate', { locale, isWeb: IS_WEB_EXT.toString() });
    context.subscriptions.push(previewmanager_1.previewManager.register());
    context.subscriptions.push((0, modfile_1.registerModFile)());
    context.subscriptions.push(worldmap_1.worldMap.register());
    context.subscriptions.push((0, dependency_1.registerScanReferencesCommand)());
    context.subscriptions.push((0, hoifs_1.registerHoiFs)());
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(constants_1.ViewType.DDS, new ddsviewprovider_1.DDSViewProvider()));
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(constants_1.ViewType.TGA, new ddsviewprovider_1.TGAViewProvider()));
    context.subscriptions.push((0, sharedFocusIndex_1.registerSharedFocusIndex)());
    context.subscriptions.push((0, gfxindex_1.registerGfxIndex)());
    context.subscriptions.push((0, localisationIndex_1.registerLocalisationIndex)());
    if (process.env.NODE_ENV !== 'production') {
        vscode.commands.registerCommand(constants_1.Commands.Test, () => {
            const debugModule = require('./util/debug.shouldignore');
            debugModule.testCommand();
        });
        (0, context_1.setVscodeContext)(constants_1.ContextName.Hoi4MUInDev, true);
    }
    (0, context_1.setVscodeContext)(constants_1.ContextName.Hoi4MULoaded, true);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map