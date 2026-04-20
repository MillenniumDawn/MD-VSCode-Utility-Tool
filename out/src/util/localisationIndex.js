"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLocalisationIndex = registerLocalisationIndex;
exports.getLocalisedTextQuick = getLocalisedTextQuick;
exports.getLocalisedText = getLocalisedText;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const path = tslib_1.__importStar(require("path"));
const yaml = tslib_1.__importStar(require("js-yaml"));
const common_1 = require("./common");
const featureflags_1 = require("./featureflags");
const fileloader_1 = require("./fileloader");
const i18n_1 = require("./i18n");
const telemetry_1 = require("./telemetry");
const logger_1 = require("./logger");
const js_yaml_1 = require("js-yaml");
const constants_1 = require("../constants");
const indexCache_1 = require("./indexCache");
const globalLocalisationIndex = {};
let workspaceLocalisationIndex = {};
// Tracks which localisation keys came from which file, per language
// langKey -> filePath -> Set<localisationKey>
const workspaceLocalisationFileMap = {};
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
async function getLocalisedTextQuick(localisationKey) {
    const previewLocalisation = vscode.workspace.getConfiguration(constants_1.ConfigurationKey).previewLocalisation;
    if (previewLocalisation) {
        return getLocalisedText(localisationKey, localeISOMapping[previewLocalisation] ?? vscode.env.language);
    }
    return getLocalisedText(localisationKey, vscode.env.language);
}
async function getLocalisedText(localisationKey, language) {
    if (!localisationKey) {
        return localisationKey;
    }
    if (!featureflags_1.localisationIndex) {
        return localisationKey ?? '';
    }
    const langKey = localeMapping[language.toLowerCase()] || 'l_english'; // use mapping to get language suffix
    const defaultLangKey = 'l_english';
    let text = globalLocalisationIndex[langKey]?.[localisationKey] ||
        workspaceLocalisationIndex[langKey]?.[localisationKey];
    if (!text) {
        text = globalLocalisationIndex[defaultLangKey]?.[localisationKey] ||
            workspaceLocalisationIndex[defaultLangKey]?.[localisationKey];
    }
    return text ?? localisationKey;
}
const LOC_CACHE_VERSION = 1;
const langSuffixes = Object.values(localeMapping);
const langSuffixPattern = langSuffixes.join('|');
const localisationFileFilter = new RegExp(`.*_(${langSuffixPattern})\\.yml$`, 'i');
async function buildGlobalLocalisationIndex(estimatedSize) {
    const options = { mod: false, hoi4: true, recursively: true };
    const localisationFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)('localisation', options)).filter(f => localisationFileFilter.test(f)).map(f => 'localisation/' + f);
    await buildLocalisationIndexWithCache('localisationIndex.global', localisationFiles, globalLocalisationIndex, null, options, estimatedSize);
}
async function buildWorkspaceLocalisationIndex(estimatedSize) {
    const options = { mod: true, hoi4: false, recursively: true };
    const localisationFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)('localisation', options)).filter(f => localisationFileFilter.test(f)).map(f => 'localisation/' + f);
    await buildLocalisationIndexWithCache('localisationIndex.workspace', localisationFiles, workspaceLocalisationIndex, workspaceLocalisationFileMap, options, estimatedSize);
}
async function buildLocalisationIndexWithCache(cacheName, locFiles, targetIndex, fileMap, options, estimatedSize) {
    const timer = new indexCache_1.IndexTimer(cacheName);
    const resolveUri = (relativePath) => (0, fileloader_1.getFilePathFromModOrHOI4)(relativePath, options);
    const currentMtimes = await (0, indexCache_1.getFileMtimes)(locFiles, resolveUri);
    timer.mark('mtime');
    const manifest = await (0, indexCache_1.loadCacheManifest)(cacheName, LOC_CACHE_VERSION);
    let filesToParse = locFiles;
    if (manifest) {
        const staleness = (0, indexCache_1.computeStaleFiles)(manifest, currentMtimes);
        const cachedData = await (0, indexCache_1.loadCacheData)(cacheName);
        if (cachedData && staleness.stale.length + staleness.removed.length + staleness.added.length < locFiles.length) {
            try {
                const cached = JSON.parse(cachedData);
                const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
                for (const langKey in cached.index) {
                    if (!targetIndex[langKey]) {
                        targetIndex[langKey] = {};
                    }
                    const fileKeysForLang = cached.fileMap?.[langKey] ?? {};
                    for (const filePath in fileKeysForLang) {
                        if (!skipFiles.has(filePath)) {
                            const keys = fileKeysForLang[filePath];
                            for (const key of keys) {
                                if (cached.index[langKey][key] !== undefined) {
                                    targetIndex[langKey][key] = cached.index[langKey][key];
                                }
                            }
                            if (fileMap) {
                                if (!fileMap[langKey]) {
                                    fileMap[langKey] = {};
                                }
                                fileMap[langKey][filePath] = new Set(keys);
                            }
                        }
                    }
                }
                filesToParse = [...staleness.stale, ...staleness.added];
            }
            catch {
                logger_1.Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
                filesToParse = locFiles;
            }
        }
    }
    timer.mark('cache');
    await Promise.all(filesToParse.map(f => fillLocalisationItems(f, targetIndex, fileMap, options, estimatedSize)));
    timer.mark('parse');
    timer.log(locFiles.length, filesToParse.length);
    // Serialize Sets to arrays for JSON cache
    const serializedFileMap = {};
    if (fileMap) {
        for (const langKey in fileMap) {
            serializedFileMap[langKey] = {};
            for (const filePath in fileMap[langKey]) {
                serializedFileMap[langKey][filePath] = [...fileMap[langKey][filePath]];
            }
        }
    }
    const cacheData = { index: targetIndex, fileMap: serializedFileMap };
    // fire-and-forget: write data before manifest for atomicity
    void Promise.all([
        (0, indexCache_1.saveCacheData)(cacheName, JSON.stringify(cacheData)),
        (0, indexCache_1.saveCacheManifest)(cacheName, locFiles, currentMtimes, LOC_CACHE_VERSION),
    ]).catch(e => logger_1.Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}
async function fillLocalisationItems(localisationFile, localisationIndex, fileMap, options, estimatedSize) {
    const [fileBuffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(localisationFile, options);
    const processedContent = preprocessYamlContent(fileBuffer.toString());
    try {
        const localisations = parseLocalisationFile(processedContent);
        for (const langKey in localisations) {
            if (!localisationIndex[langKey]) {
                localisationIndex[langKey] = {};
            }
            Object.assign(localisationIndex[langKey], localisations[langKey]);
            if (fileMap) {
                if (!fileMap[langKey]) {
                    fileMap[langKey] = {};
                }
                fileMap[langKey][localisationFile] = new Set(Object.keys(localisations[langKey]));
            }
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
}
const localisationLineRegex = /^\s*([^:]+):\s*\d*\s*"((?:[^"#\\]|\\.)*)".*?(?=#|$)/;
const unescapedQuoteRegex = /(?<!\\)"/g;
function preprocessYamlContent(fileContent) {
    const lines = fileContent.split(/\r?\n/);
    // Filter out any lines that start with #, regardless of leading spaces
    const filteredLines = lines.filter(line => !/^\s*#/.test(line));
    const header = filteredLines.length > 0 ? filteredLines[0].replace(/^\s+/, '') : '';
    const processedLines = filteredLines.slice(1).map(line => {
        return ' ' + line
            .replace(localisationLineRegex, (match, p1, p2) => {
            const escapedContent = p2.replace(unescapedQuoteRegex, '\\"');
            return `${p1}: "${escapedContent}"`;
        })
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
    for (const langKey in workspaceLocalisationFileMap) {
        delete workspaceLocalisationFileMap[langKey];
    }
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
    if (file.path.endsWith('.yml') && document.isDirty) {
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
            const fileKeys = workspaceLocalisationFileMap[langKey]?.[relative];
            if (fileKeys && workspaceLocalisationIndex[langKey]) {
                for (const key of fileKeys) {
                    delete workspaceLocalisationIndex[langKey][key];
                }
                delete workspaceLocalisationFileMap[langKey][relative];
            }
        }
    }
}
function addWorkspaceLocalisationIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('localisation/')) {
            fillLocalisationItems(relative, workspaceLocalisationIndex, workspaceLocalisationFileMap, { hoi4: false });
        }
    }
}
function getLangKeyFromPath(filePath) {
    const match = filePath.match(localisationFileFilter);
    return match ? match[1] : 'l_english';
}
//# sourceMappingURL=localisationIndex.js.map