"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDependenciesFromText = getDependenciesFromText;
exports.registerScanReferencesCommand = registerScanReferencesCommand;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const constants_1 = require("../constants");
const telemetry_1 = require("./telemetry");
const i18n_1 = require("./i18n");
const context_1 = require("../context");
const debug_1 = require("./debug");
const fileloader_1 = require("./fileloader");
const hoiparser_1 = require("../hoiformat/hoiparser");
const schema_1 = require("../previewdef/event/schema");
const vsccommon_1 = require("./vsccommon");
const lodash_1 = require("lodash");
const yaml_1 = require("./yaml");
function getDependenciesFromText(text) {
    const dependencies = [];
    const regex = /^\s*#!(?<type>.*?):(?<path>.*\.(?<ext>.*?))$/gm;
    let match = regex.exec(text);
    while (match) {
        const type = match.groups?.type;
        const ext = match.groups?.ext;
        if (type && (type === ext || ext === 'txt' || ext === 'yml')) {
            const path = match.groups?.path;
            const pathValue = path.trim().replace(/\/\/+|\\+/g, '/');
            dependencies.push({ type, path: pathValue });
        }
        match = regex.exec(text);
    }
    return dependencies;
}
function registerScanReferencesCommand() {
    return vscode.commands.registerCommand(constants_1.Commands.ScanReferences, scanReferences);
}
async function scanReferences() {
    (0, telemetry_1.sendEvent)('scanReferences');
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage((0, i18n_1.localize)('scanref.noeditor', 'No opened editor.'));
        return;
    }
    try {
        if (context_1.contextContainer.contextValue[constants_1.ContextName.Hoi4PreviewType] === 'event') {
            await scanReferencesForEvents(editor);
            vscode.window.showInformationMessage((0, i18n_1.localize)('scanref.done', 'Scan reference done.'));
        }
        else {
            vscode.window.showErrorMessage((0, i18n_1.localize)('scanref.unsupportedtype', 'Unsupported file type to scan references.'));
        }
    }
    catch (e) {
        (0, debug_1.error)(e);
    }
}
async function scanReferencesForEvents(editor) {
    const eventFiles = await (0, fileloader_1.listFilesFromModOrHOI4)('events');
    const document = editor.document;
    const events = (await Promise.all(eventFiles.map(async (file) => {
        try {
            const filePath = 'events/' + file;
            const [buffer, realPath] = await (0, fileloader_1.readFileFromModOrHOI4)(filePath);
            const realPathUri = (0, fileloader_1.getHoiOpenedFileOriginalUri)(realPath);
            if ((0, vsccommon_1.isSameUri)(document.uri, realPathUri)) {
                return undefined;
            }
            return (0, schema_1.getEvents)((0, hoiparser_1.parseHoi4File)(buffer.toString()), filePath);
        }
        catch (e) {
            return undefined;
        }
    }))).filter((e) => e !== undefined);
    if (document.isClosed) {
        return;
    }
    const eventItems = (0, lodash_1.flatMap)(events, e => (0, lodash_1.flatten)(Object.values(e.eventItemsByNamespace)));
    const includedEventFiles = [];
    const relativePath = (0, vsccommon_1.getRelativePathInWorkspace)(document.uri);
    const content = document.getText();
    const mainEvents = (0, lodash_1.flatten)(Object.values((0, schema_1.getEvents)((0, hoiparser_1.parseHoi4File)(content), relativePath).eventItemsByNamespace));
    const searchingEvents = [...mainEvents];
    const searched = {};
    const searchedEvents = [];
    const childrenById = {};
    [...eventItems, ...mainEvents].forEach(event => {
        childrenById[event.id] = (0, lodash_1.flatMap)([event.immediate, ...event.options], o => o.childEvents).map(ce => ce.eventName);
    });
    while (searchingEvents.length > 0) {
        const event = searchingEvents.pop();
        const children = childrenById[event.id];
        eventItems.forEach(ei => {
            if (searched[ei.id]) {
                return;
            }
            if (children.includes(ei.id)) {
                searchingEvents.push(ei);
                if (!includedEventFiles.includes(ei.file)) {
                    includedEventFiles.push(ei.file);
                }
            }
            const eiChildren = childrenById[ei.id];
            if (eiChildren.includes(event.id)) {
                searchingEvents.push(ei);
                if (!includedEventFiles.includes(ei.file)) {
                    includedEventFiles.push(ei.file);
                }
            }
        });
        searched[event.id] = true;
        searchedEvents.push(event);
    }
    if (document.isClosed) {
        return;
    }
    const existingDependency = getDependenciesFromText(document.getText());
    const existingEventDependency = existingDependency.filter(d => d.type === 'event').map(d => d.path.replace(/\\+/g, '/'));
    existingEventDependency.push(relativePath);
    const moreEventDependencyContent = includedEventFiles.filter(f => !existingEventDependency.includes(f)).map(f => `#!event:${f}\n`).join('');
    const localizationFiles = await (0, fileloader_1.listFilesFromModOrHOI4)('localisation');
    const language = (0, vsccommon_1.getLanguageIdInYml)();
    const localizations = (await Promise.all(localizationFiles.map(async (file) => {
        try {
            const filePath = 'localisation/' + file;
            const [buffer, realPath] = await (0, fileloader_1.readFileFromModOrHOI4)(filePath);
            const realPathUri = (0, fileloader_1.getHoiOpenedFileOriginalUri)(realPath);
            if ((0, vsccommon_1.isSameUri)(document.uri, realPathUri)) {
                return undefined;
            }
            return { file: filePath, result: (0, yaml_1.parseYaml)(buffer.toString()) };
        }
        catch (e) {
            return undefined;
        }
    }))).filter((e) => e !== undefined && e.result !== undefined && typeof e.result[language] === 'object' && !Array.isArray(e.result[language]));
    const existingLocalizationDependency = existingDependency.filter(d => d.type.match(/^locali[zs]ation$/)).map(d => d.path.replace(/\\+/g, '/'));
    const moreLocalizationDependencyContent = localizations.filter(lf => {
        if (existingLocalizationDependency.includes(lf.file)) {
            return false;
        }
        for (const event of searchedEvents) {
            if ([event.title, ...event.options.map(o => o.name)].some(n => n && n in lf.result[language])) {
                return true;
            }
        }
        return false;
    }).map(lf => `#!localisation:${lf.file}\n`).join('');
    if (document.isClosed) {
        return;
    }
    await editor.edit(eb => {
        eb.insert(new vscode.Position(0, 0), moreEventDependencyContent + moreLocalizationDependencyContent);
    });
}
//# sourceMappingURL=dependency.js.map