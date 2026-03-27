import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { debounceByInput } from './common';
import { localisationIndex } from './featureflags';
import { getFilePathFromModOrHOI4, listFilesFromModOrHOI4, readFileFromModOrHOI4 } from './fileloader';
import { localize } from './i18n';
import { sendEvent } from './telemetry';
import { Logger } from "./logger";
import { YAMLException } from "js-yaml";
import { ConfigurationKey } from '../constants';
import { loadCacheManifest, loadCacheData, saveCacheManifest, saveCacheData, getFileMtimes, computeStaleFiles } from './indexCache';

type LocalisationData = Record<string, Record<string, string>>;

const globalLocalisationIndex: LocalisationData = {};
let workspaceLocalisationIndex: LocalisationData = {};

// Tracks which localisation keys came from which file, per language
// langKey -> filePath -> Set<localisationKey>
const workspaceLocalisationFileMap: Record<string, Record<string, Set<string>>> = {};

// Mapping of language ISO codes to yml file language suffixes
const localeMapping: Record<string, string> = {
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
const localeISOMapping: Record<string, string> = {
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

export function registerLocalisationIndex(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    if (localisationIndex) {
        const estimatedSize: [number] = [0];
        const task = Promise.all([
            buildGlobalLocalisationIndex(estimatedSize),
            buildWorkspaceLocalisationIndex(estimatedSize)
        ]);
        vscode.window.setStatusBarMessage('$(loading~spin) ' + localize('localisationIndex.building', 'Building Localisation index...'), task);
        task.then(() => {
            vscode.window.showInformationMessage(localize('localisationIndex.builddone', 'Building Localisation index done.'));
            sendEvent('localisationIndex', {size: estimatedSize[0].toString()});
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

export async function getLocalisedTextQuick(localisationKey: string | undefined): Promise<string | undefined> {
    const previewLocalisation = vscode.workspace.getConfiguration(ConfigurationKey).previewLocalisation;
    if (previewLocalisation){
        return getLocalisedText(localisationKey, localeISOMapping[previewLocalisation]?? vscode.env.language);
    }
    return getLocalisedText(localisationKey, vscode.env.language);
}

export async function getLocalisedText(localisationKey: string | undefined, language: string): Promise<string | undefined> {
    if (!localisationKey) {
        return localisationKey;
    }

    if (!localisationIndex) {
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

interface LocCacheData {
    index: LocalisationData;
    fileMap: Record<string, Record<string, string[]>>; // langKey -> filePath -> keys[]
}

async function buildGlobalLocalisationIndex(estimatedSize: [number]): Promise<void> {
    const options = {mod: false, hoi4: true, recursively: true};
    const localisationFiles = (await listFilesFromModOrHOI4('localisation', options)).filter(f => localisationFileFilter.test(f)).map(f => 'localisation/' + f);
    await buildLocalisationIndexWithCache('localisationIndex.global', localisationFiles, globalLocalisationIndex, null, options, estimatedSize);
}

async function buildWorkspaceLocalisationIndex(estimatedSize: [number]): Promise<void> {
    const options = {mod: true, hoi4: false, recursively: true};
    const localisationFiles = (await listFilesFromModOrHOI4('localisation', options)).filter(f => localisationFileFilter.test(f)).map(f => 'localisation/' + f);
    await buildLocalisationIndexWithCache('localisationIndex.workspace', localisationFiles, workspaceLocalisationIndex, workspaceLocalisationFileMap, options, estimatedSize);
}

async function buildLocalisationIndexWithCache(
    cacheName: string,
    locFiles: string[],
    targetIndex: LocalisationData,
    fileMap: Record<string, Record<string, Set<string>>> | null,
    options: { mod?: boolean; hoi4?: boolean },
    estimatedSize: [number]
): Promise<void> {
    const resolveUri = (relativePath: string) => getFilePathFromModOrHOI4(relativePath, options);
    const currentMtimes = await getFileMtimes(locFiles, resolveUri);
    const manifest = await loadCacheManifest(cacheName, LOC_CACHE_VERSION);

    let filesToParse = locFiles;

    if (manifest) {
        const staleness = computeStaleFiles(manifest, currentMtimes);
        const cachedData = await loadCacheData(cacheName);

        if (cachedData && staleness.stale.length + staleness.removed.length + staleness.added.length < locFiles.length) {
            try {
                const cached: LocCacheData = JSON.parse(cachedData);
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
                Logger.info(`${cacheName}: restored from cache, re-parsing ${filesToParse.length} files`);
            } catch {
                Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
                filesToParse = locFiles;
            }
        }
    }

    await Promise.all(filesToParse.map(f => fillLocalisationItems(f, targetIndex, fileMap, options, estimatedSize)));

    // Serialize Sets to arrays for JSON cache
    const serializedFileMap: Record<string, Record<string, string[]>> = {};
    if (fileMap) {
        for (const langKey in fileMap) {
            serializedFileMap[langKey] = {};
            for (const filePath in fileMap[langKey]) {
                serializedFileMap[langKey][filePath] = [...fileMap[langKey][filePath]];
            }
        }
    }
    const cacheData: LocCacheData = { index: targetIndex, fileMap: serializedFileMap };
    // fire-and-forget: write data before manifest for atomicity
    void Promise.all([
        saveCacheData(cacheName, JSON.stringify(cacheData)),
        saveCacheManifest(cacheName, locFiles, currentMtimes, LOC_CACHE_VERSION),
    ]).catch(e => Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}

async function fillLocalisationItems(localisationFile: string, localisationIndex: LocalisationData, fileMap: Record<string, Record<string, Set<string>>> | null, options: {
    mod?: boolean,
    hoi4?: boolean
}, estimatedSize?: [number]): Promise<void> {
    const [fileBuffer, uri] = await readFileFromModOrHOI4(localisationFile, options);
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
    } catch (e) {
        console.log(localisationFile);
        console.log(processedContent);
        console.error(e);

        const baseMessage = options.hoi4
            ? localize('localisationIndex.vanilla','[Vanilla]')
            : localize('localisationIndex.mod','[mod]');

        const failureMessage = localize('localisationIndex.parseFailure','parsing failed! Please check if the file has issues!');

        if (e instanceof YAMLException) {
            Logger.error(`${baseMessage} ${localisationFile} ${failureMessage}\n${e.message}`);
        } else {
            Logger.error(`${baseMessage} ${localisationFile} ${failureMessage}`);
        }
    }
}

const localisationLineRegex = /^\s*([^:]+):\s*\d*\s*"((?:[^"#\\]|\\.)*)".*?(?=#|$)/;
const unescapedQuoteRegex = /(?<!\\)"/g;

function preprocessYamlContent(fileContent: string): string {
    const lines = fileContent.split(/\r?\n/);

    // Filter out any lines that start with #, regardless of leading spaces
    const filteredLines = lines.filter(line =>
        !/^\s*#/.test(line)
    );

    const header = filteredLines.length > 0 ? filteredLines[0].replace(/^\s+/, '') : '';
    const processedLines = filteredLines.slice(1).map(line => {
        return ' ' + line
            .replace(
                localisationLineRegex,
                (match, p1, p2) => {
                    const escapedContent = p2.replace(unescapedQuoteRegex, '\\"');
                    return `${p1}: "${escapedContent}"`;
                }
            )
            .replace(/^\s+/, '');
    }).filter(line =>
        line.trim() !== ''
    );

    return [header, ...processedLines].join('\n');
}

function parseLocalisationFile(fileContent: string): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};

    const parsed = yaml.load(fileContent, {schema: yaml.JSON_SCHEMA, json: true}) as Record<string, any>;

    for (const langKey in parsed) {
        if (langKey.startsWith('l_')) {
            result[langKey] = result[langKey] || {};
            const entries = parsed[langKey] as Record<string, string>;

            for (const key in entries) {
                result[langKey][key] = entries[key].replace(/YAMLParsingLFReplacement/g, '\n');
            }
        }
    }

    return result;
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
    workspaceLocalisationIndex = {};
    for (const langKey in workspaceLocalisationFileMap) {
        delete workspaceLocalisationFileMap[langKey];
    }
    const estimatedSize: [number] = [0];
    const task = buildWorkspaceLocalisationIndex(estimatedSize);
    vscode.window.setStatusBarMessage('$(loading~spin) ' + localize('localisationIndex.workspace.building', 'Building workspace Localisation index...'), task);
    task.then(() => {
        vscode.window.showInformationMessage(localize('localisationIndex.workspace.builddone', 'Building workspace Localisation index done.'));
        sendEvent('localisationIndex.workspace', {size: estimatedSize[0].toString()});
    });
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    const file = e.document.uri;
    if (file.path.endsWith('.yml')) {
        onChangeTextDocumentImpl(file);
    }
}

const onChangeTextDocumentImpl = debounceByInput(
    (file: vscode.Uri) => {
        removeWorkspaceLocalisationIndex(file);
        addWorkspaceLocalisationIndex(file);
    },
    file => file.toString(),
    1000,
    {trailing: true}
);

function onCloseTextDocument(document: vscode.TextDocument) {
    const file = document.uri;
    if (file.path.endsWith('.yml') && document.isDirty) {
        removeWorkspaceLocalisationIndex(file);
        addWorkspaceLocalisationIndex(file);
    }
}

function onCreateFiles(e: vscode.FileCreateEvent) {
    for (const file of e.files) {
        if (file.path.endsWith('.yml')) {
            addWorkspaceLocalisationIndex(file);
        }
    }
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
    for (const file of e.files) {
        if (file.path.endsWith('.yml')) {
            removeWorkspaceLocalisationIndex(file);
        }
    }
}

function onRenameFiles(e: vscode.FileRenameEvent) {
    onDeleteFiles({files: e.files.map(f => f.oldUri)});
    onCreateFiles({files: e.files.map(f => f.newUri)});
}

function removeWorkspaceLocalisationIndex(file: vscode.Uri) {
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

function addWorkspaceLocalisationIndex(file: vscode.Uri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('localisation/')) {
            fillLocalisationItems(relative, workspaceLocalisationIndex, workspaceLocalisationFileMap, {hoi4: false});
        }
    }
}

function getLangKeyFromPath(filePath: string): string {
    const match = filePath.match(localisationFileFilter);
    return match ? match[1] : 'l_english';
}