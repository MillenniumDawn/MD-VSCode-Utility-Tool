"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfiguration = getConfiguration;
exports.getDocumentByUri = getDocumentByUri;
exports.getRelativePathInWorkspace = getRelativePathInWorkspace;
exports.isFileScheme = isFileScheme;
exports.ensureFileScheme = ensureFileScheme;
exports.isSameUri = isSameUri;
exports.getLastModifiedAsync = getLastModifiedAsync;
exports.readDir = readDir;
exports.readDirFiles = readDirFiles;
exports.readDirFilesRecursively = readDirFilesRecursively;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.mkdirs = mkdirs;
exports.isFile = isFile;
exports.isDirectory = isDirectory;
exports.dirUri = dirUri;
exports.basename = basename;
exports.fileOrUriStringToUri = fileOrUriStringToUri;
exports.uriToFilePathWhenPossible = uriToFilePathWhenPossible;
exports.getLanguageIdInYml = getLanguageIdInYml;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const path = tslib_1.__importStar(require("path"));
const i18n_1 = require("./i18n");
const common_1 = require("./common");
const nodecommon_1 = require("./nodecommon");
const constants_1 = require("../constants");
function getConfiguration() {
    return vscode.workspace.getConfiguration(constants_1.ConfigurationKey);
}
function getDocumentByUri(uri) {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}
function getRelativePathInWorkspace(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
        return path.relative(folder.uri.path, uri.path).replace(/\\/g, '/');
    }
    else {
        ensureFileScheme(uri);
        return uri.fsPath;
    }
}
function isFileScheme(uri) {
    return uri.scheme === 'file';
}
function ensureFileScheme(uri) {
    if (!isFileScheme(uri)) {
        throw new common_1.UserError((0, i18n_1.localize)('filenotondisk', 'File is not on disk: {0}.', uri.toString()));
    }
}
function isSameUri(uriA, uriB) {
    return (isFileScheme(uriA) && isFileScheme(uriB) && (0, nodecommon_1.isSamePath)(uriA.fsPath, uriB.fsPath)) || uriA.toString() === uriB.toString();
}
async function getLastModifiedAsync(path) {
    return (await vscode.workspace.fs.stat(path)).mtime;
}
async function readDir(dir) {
    return (await vscode.workspace.fs.readDirectory(dir)).map(f => f[0]);
}
async function readDirFiles(dir) {
    return (await vscode.workspace.fs.readDirectory(dir)).filter(f => f[1] === vscode.FileType.File).map(f => f[0]);
}
async function readDirFilesRecursively(dir) {
    const result = [];
    await readDirFilesRecursivelyImpl(dir, '', result);
    return result;
}
async function readDirFilesRecursivelyImpl(dir, prefix, result) {
    const items = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of items) {
        if (type === vscode.FileType.File) {
            result.push(prefix + name);
        }
        else if (type === vscode.FileType.Directory) {
            await readDirFilesRecursivelyImpl(vscode.Uri.joinPath(dir, name), prefix + name + '/', result);
        }
    }
}
async function readFile(path) {
    return Buffer.from(await vscode.workspace.fs.readFile(path));
}
async function writeFile(path, buffer) {
    return await vscode.workspace.fs.writeFile(path, buffer);
}
async function mkdirs(path) {
    await vscode.workspace.fs.createDirectory(path);
}
async function isFile(path) {
    try {
        return (await vscode.workspace.fs.stat(path)).type === vscode.FileType.File;
    }
    catch (e) {
        return false;
    }
}
async function isDirectory(path) {
    try {
        return (await vscode.workspace.fs.stat(path)).type === vscode.FileType.Directory;
    }
    catch (e) {
        return false;
    }
}
function dirUri(uri) {
    const updatedPath = path.dirname(uri.path);
    return uri.with({ path: updatedPath });
}
function basename(uri, ext) {
    return path.basename(uri.path, ext);
}
function fileOrUriStringToUri(path) {
    const normalizedPath = normalizeFileOrUriString(path);
    if (normalizedPath === '') {
        return undefined;
    }
    try {
        if (/^[a-zA-Z]:[\\/]/.test(normalizedPath) || /^\\\\/.test(normalizedPath)) {
            return vscode.Uri.file(normalizedPath);
        }
        if (normalizedPath.indexOf(':') > 2) { // try to avoid prefix like "D:\"
            return vscode.Uri.parse(normalizedPath);
        }
        else {
            return vscode.Uri.file(normalizedPath);
        }
    }
    catch (e) {
        return undefined;
    }
}
function normalizeFileOrUriString(path) {
    const trimmedPath = path.trim();
    if (trimmedPath.length >= 2) {
        const startsWithDoubleQuote = trimmedPath.startsWith('"') && trimmedPath.endsWith('"');
        const startsWithSingleQuote = trimmedPath.startsWith("'") && trimmedPath.endsWith("'");
        if (startsWithDoubleQuote || startsWithSingleQuote) {
            return trimmedPath.slice(1, -1).trim();
        }
    }
    return trimmedPath;
}
function uriToFilePathWhenPossible(uri) {
    if (isFileScheme(uri)) {
        return uri.fsPath;
    }
    return uri.toString();
}
const languageYmlDict = {
    ['Brazilian Portuguese']: 'l_braz_por',
    English: 'l_english',
    French: 'l_french',
    German: 'l_german',
    Japanese: 'l_japanese',
    Polish: 'l_polish',
    Russian: 'l_russian',
    ['Simplified Chinese']: 'l_simp_chinese',
    Spanish: 'l_spanish',
};
function getLanguageIdInYml() {
    return languageYmlDict[vscode.workspace.getConfiguration(constants_1.ConfigurationKey).previewLocalisation ?? 'English'] ?? languageYmlDict['English'];
}
//# sourceMappingURL=vsccommon.js.map