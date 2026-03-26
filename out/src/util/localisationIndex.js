"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalisedText = exports.getLocalisedTextQuick = exports.registerLocalisationIndex = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const path = require("path");
const yaml = require("js-yaml");
const common_1 = require("./common");
const featureflags_1 = require("./featureflags");
const fileloader_1 = require("./fileloader");
const i18n_1 = require("./i18n");
const telemetry_1 = require("./telemetry");
const logger_1 = require("./logger");
const js_yaml_1 = require("js-yaml");
const constants_1 = require("../constants");
const globalLocalisationIndex = {};
let workspaceLocalisationIndex = {};
// Mapping of language ISO codes to yml file language suffixes
const localeMapping = {
    'en': 'l_english',
    'pt-br': 'l_braz_por',
    'de': 'l_german',
    'fr': 'l_french',
    'es': 'l_spanish',
    'pl': 'l_polish',
    'ru': 'l_russian',
    'ja': 'l_japanese',
    'zh-cn': 'l_simp_chinese',
};
// Mapping of language profiles to language ISO codes
const localeISOMapping = {
    ['Brazilian Portuguese']: 'pt-br',
    English: 'en',
    French: 'fr',
    German: 'de',
    Japanese: 'ja',
    Polish: 'pl',
    Russian: 'ru',
    ['Simplified Chinese']: 'zh-cn',
    Spanish: 'es',
};
function registerLocalisationIndex() {
    const disposables = [];
    if (featureflags_1.localisationIndex) {
        const estimatedSize = [0];
        const task = Promise.all([
            buildGlobalLocalisationIndex(estimatedSize),
            buildWorkspaceLocalisationIndex(estimatedSize)
        ]);
        vscode.window.setStatusBarMessage('$(loading~spin) ' + (0, i18n_1.localize)('localisationIndex.building', 'Building Localisation index...'), task);
        task.then(() => {
            vscode.window.showInformationMessage((0, i18n_1.localize)('localisationIndex.builddone', 'Building Localisation index done.'));
            (0, telemetry_1.sendEvent)('localisationIndex', { size: estimatedSize[0].toString() });
        });
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
    }
    return vscode.Disposable.from(...disposables);
}
exports.registerLocalisationIndex = registerLocalisationIndex;
function getLocalisedTextQuick(localisationKey) {
    var _a;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const previewLocalisation = vscode.workspace.getConfiguration(constants_1.ConfigurationKey).previewLocalisation;
        if (previewLocalisation) {
            return getLocalisedText(localisationKey, (_a = localeISOMapping[previewLocalisation]) !== null && _a !== void 0 ? _a : vscode.env.language);
        }
        return getLocalisedText(localisationKey, vscode.env.language);
    });
}
exports.getLocalisedTextQuick = getLocalisedTextQuick;
function getLocalisedText(localisationKey, language) {
    var _a, _b, _c, _d;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!localisationKey) {
            return localisationKey;
        }
        if (!featureflags_1.localisationIndex) {
            return localisationKey !== null && localisationKey !== void 0 ? localisationKey : '';
        }
        const langKey = localeMapping[language.toLowerCase()] || 'l_english'; // use mapping to get language suffix
        const defaultLangKey = 'l_english';
        let text = ((_a = globalLocalisationIndex[langKey]) === null || _a === void 0 ? void 0 : _a[localisationKey]) ||
            ((_b = workspaceLocalisationIndex[langKey]) === null || _b === void 0 ? void 0 : _b[localisationKey]);
        if (!text) {
            text = ((_c = globalLocalisationIndex[defaultLangKey]) === null || _c === void 0 ? void 0 : _c[localisationKey]) ||
                ((_d = workspaceLocalisationIndex[defaultLangKey]) === null || _d === void 0 ? void 0 : _d[localisationKey]);
        }
        return text !== null && text !== void 0 ? text : localisationKey;
    });
}
exports.getLocalisedText = getLocalisedText;
function buildGlobalLocalisationIndex(estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const options = { mod: false, hoi4: true, recursively: true };
        const localisationFiles = (yield (0, fileloader_1.listFilesFromModOrHOI4)('localisation', options)).filter(f => /.*_(l_english|l_braz_por|l_german|l_french|l_spanish|l_polish|l_russian|l_japanese|l_simp_chinese)\.yml$/i.test(f));
        yield Promise.all(localisationFiles.map(f => fillLocalisationItems('localisation/' + f, globalLocalisationIndex, options, estimatedSize)));
    });
}
function buildWorkspaceLocalisationIndex(estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const options = { mod: true, hoi4: false, recursively: true };
        const localisationFiles = (yield (0, fileloader_1.listFilesFromModOrHOI4)('localisation', options)).filter(f => /.*_(l_english|l_braz_por|l_german|l_french|l_spanish|l_polish|l_russian|l_japanese|l_simp_chinese)\.yml$/i.test(f));
        yield Promise.all(localisationFiles.map(f => fillLocalisationItems('localisation/' + f, workspaceLocalisationIndex, options, estimatedSize)));
    });
}
function fillLocalisationItems(localisationFile, localisationIndex, options, estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [fileBuffer, uri] = yield (0, fileloader_1.readFileFromModOrHOI4)(localisationFile, options);
        const processedContent = preprocessYamlContent(fileBuffer.toString());
        try {
            const localisations = parseLocalisationFile(processedContent);
            for (const langKey in localisations) {
                if (!localisationIndex[langKey]) {
                    localisationIndex[langKey] = {};
                }
                Object.assign(localisationIndex[langKey], localisations[langKey]);
                if (estimatedSize) {
                    estimatedSize[0] += Object.keys(localisations[langKey]).reduce((sum, key) => sum + key.length + localisations[langKey][key].length, 0);
                }
            }
        }
        catch (e) {
            console.log(localisationFile);
            console.log(processedContent);
            console.error(e);
            const baseMessage = options.hoi4
                ? (0, i18n_1.localize)('localisationIndex.vanilla', '[Vanilla]')
                : (0, i18n_1.localize)('localisationIndex.mod', '[mod]');
            const failureMessage = (0, i18n_1.localize)('localisationIndex.parseFailure', 'parsing failed! Please check if the file has issues!');
            if (e instanceof js_yaml_1.YAMLException) {
                logger_1.Logger.error(`${baseMessage} ${localisationFile} ${failureMessage}\n${e.message}`);
            }
            else {
                logger_1.Logger.error(`${baseMessage} ${localisationFile} ${failureMessage}`);
            }
        }
    });
}
function preprocessYamlContent(fileContent) {
    const lines = fileContent.split(/\r?\n/);
    // Filter out any lines that start with #, regardless of leading spaces
    const filteredLines = lines.filter(line => !/^\s*#/.test(line));
    const header = filteredLines.length > 0 ? filteredLines[0].replace(/^\s+/, '') : '';
    // Can't the goddamn Paradox employees and modders just write standard localization yml files?
    const processedLines = filteredLines.slice(1).map(line => {
        return ' ' + line
            .replace(/\n/g, 'YAMLParsingLFReplacement')
            .replace(/^\s*([^:]+):\s*\d*\s*"((?:[^"#\\]|\\.)*)".*?(?=#|$)/, (match, p1, p2) => {
            // Replace unescaped quotes with escaped ones
            const escapedContent = p2.replace(/(?<!\\)"/g, '\\"');
            return `${p1}: "${escapedContent}"`;
        })
            .replace(/:(\d+)(?=[^"]*")/, ':')
            .replace(/^\s+/, '');
    }).filter(line => line.trim() !== '');
    return [header, ...processedLines].join('\n');
}
function parseLocalisationFile(fileContent) {
    const result = {};
    const parsed = yaml.load(fileContent, { schema: yaml.JSON_SCHEMA, json: true });
    for (const langKey in parsed) {
        if (langKey.startsWith('l_')) {
            result[langKey] = result[langKey] || {};
            const entries = parsed[langKey];
            for (const key in entries) {
                result[langKey][key] = entries[key].replace(/YAMLParsingLFReplacement/g, '\n');
            }
        }
    }
    return result;
}
function onChangeWorkspaceFolders(_) {
    workspaceLocalisationIndex = {};
    const estimatedSize = [0];
    const task = buildWorkspaceLocalisationIndex(estimatedSize);
    vscode.window.setStatusBarMessage('$(loading~spin) ' + (0, i18n_1.localize)('localisationIndex.workspace.building', 'Building workspace Localisation index...'), task);
    task.then(() => {
        vscode.window.showInformationMessage((0, i18n_1.localize)('localisationIndex.workspace.builddone', 'Building workspace Localisation index done.'));
        (0, telemetry_1.sendEvent)('localisationIndex.workspace', { size: estimatedSize[0].toString() });
    });
}
function onChangeTextDocument(e) {
    const file = e.document.uri;
    if (file.path.endsWith('.yml')) {
        onChangeTextDocumentImpl(file);
    }
}
const onChangeTextDocumentImpl = (0, common_1.debounceByInput)((file) => {
    removeWorkspaceLocalisationIndex(file);
    addWorkspaceLocalisationIndex(file);
}, file => file.toString(), 1000, { trailing: true });
function onCloseTextDocument(document) {
    const file = document.uri;
    if (file.path.endsWith('.yml')) {
        removeWorkspaceLocalisationIndex(file);
        addWorkspaceLocalisationIndex(file);
    }
}
function onCreateFiles(e) {
    for (const file of e.files) {
        if (file.path.endsWith('.yml')) {
            addWorkspaceLocalisationIndex(file);
        }
    }
}
function onDeleteFiles(e) {
    for (const file of e.files) {
        if (file.path.endsWith('.yml')) {
            removeWorkspaceLocalisationIndex(file);
        }
    }
}
function onRenameFiles(e) {
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}
function removeWorkspaceLocalisationIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('localisation/')) {
            const langKey = getLangKeyFromPath(relative);
            delete workspaceLocalisationIndex[langKey];
        }
    }
}
function addWorkspaceLocalisationIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('localisation/')) {
            fillLocalisationItems(relative, workspaceLocalisationIndex, { hoi4: false });
        }
    }
}
function getLangKeyFromPath(filePath) {
    const match = filePath.match(/.*_(l_english|l_braz_por|l_german|l_french|l_spanish|l_polish|l_russian|l_japanese|l_simp_chinese)\.yml$/i);
    return match ? match[1] : 'l_english';
}
//# sourceMappingURL=localisationIndex.js.map