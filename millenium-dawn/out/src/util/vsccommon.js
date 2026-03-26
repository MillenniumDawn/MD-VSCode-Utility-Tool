"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLanguageIdInYml = exports.uriToFilePathWhenPossible = exports.fileOrUriStringToUri = exports.basename = exports.dirUri = exports.isDirectory = exports.isFile = exports.mkdirs = exports.writeFile = exports.readFile = exports.readDirFilesRecursively = exports.readDirFiles = exports.readDir = exports.getLastModifiedAsync = exports.isSameUri = exports.ensureFileScheme = exports.isFileScheme = exports.getRelativePathInWorkspace = exports.getDocumentByUri = exports.getConfiguration = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const path = require("path");
const i18n_1 = require("./i18n");
const common_1 = require("./common");
const nodecommon_1 = require("./nodecommon");
const constants_1 = require("../constants");
function getConfiguration() {
    return vscode.workspace.getConfiguration(constants_1.ConfigurationKey);
}
exports.getConfiguration = getConfiguration;
function getDocumentByUri(uri) {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}
exports.getDocumentByUri = getDocumentByUri;
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
exports.getRelativePathInWorkspace = getRelativePathInWorkspace;
function isFileScheme(uri) {
    return uri.scheme === 'file';
}
exports.isFileScheme = isFileScheme;
function ensureFileScheme(uri) {
    if (!isFileScheme(uri)) {
        throw new common_1.UserError((0, i18n_1.localize)('filenotondisk', 'File is not on disk: {0}.', uri.toString()));
    }
}
exports.ensureFileScheme = ensureFileScheme;
function isSameUri(uriA, uriB) {
    return (isFileScheme(uriA) && isFileScheme(uriB) && (0, nodecommon_1.isSamePath)(uriA.fsPath, uriB.fsPath)) || uriA.toString() === uriB.toString();
}
exports.isSameUri = isSameUri;
function getLastModifiedAsync(path) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return (yield vscode.workspace.fs.stat(path)).mtime;
    });
}
exports.getLastModifiedAsync = getLastModifiedAsync;
function readDir(dir) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return (yield vscode.workspace.fs.readDirectory(dir)).map(f => f[0]);
    });
}
exports.readDir = readDir;
function readDirFiles(dir) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return (yield vscode.workspace.fs.readDirectory(dir)).filter(f => f[1] === vscode.FileType.File).map(f => f[0]);
    });
}
exports.readDirFiles = readDirFiles;
function readDirFilesRecursively(dir) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const result = [];
        yield readDirFilesRecursivelyImpl(dir, '', result);
        return result;
    });
}
exports.readDirFilesRecursively = readDirFilesRecursively;
function readDirFilesRecursivelyImpl(dir, prefix, result) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const items = yield vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of items) {
            if (type === vscode.FileType.File) {
                result.push(prefix + name);
            }
            else if (type === vscode.FileType.Directory) {
                yield readDirFilesRecursivelyImpl(vscode.Uri.joinPath(dir, name), prefix + name + '/', result);
            }
        }
    });
}
function readFile(path) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return Buffer.from(yield vscode.workspace.fs.readFile(path));
    });
}
exports.readFile = readFile;
function writeFile(path, buffer) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return yield vscode.workspace.fs.writeFile(path, buffer);
    });
}
exports.writeFile = writeFile;
function mkdirs(path) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield vscode.workspace.fs.createDirectory(path);
    });
}
exports.mkdirs = mkdirs;
function isFile(path) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            return (yield vscode.workspace.fs.stat(path)).type === vscode.FileType.File;
        }
        catch (e) {
            return false;
        }
    });
}
exports.isFile = isFile;
function isDirectory(path) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            return (yield vscode.workspace.fs.stat(path)).type === vscode.FileType.Directory;
        }
        catch (e) {
            return false;
        }
    });
}
exports.isDirectory = isDirectory;
function dirUri(uri) {
    const updatedPath = path.dirname(uri.path);
    return uri.with({ path: updatedPath });
}
exports.dirUri = dirUri;
function basename(uri, ext) {
    return path.basename(uri.path, ext);
}
exports.basename = basename;
function fileOrUriStringToUri(path) {
    if (path.trim() === '') {
        return undefined;
    }
    try {
        if (path.indexOf(':') > 2) { // try to avoid prefix like "D:\"
            return vscode.Uri.parse(path);
        }
        else {
            return vscode.Uri.file(path);
        }
    }
    catch (e) {
        return undefined;
    }
}
exports.fileOrUriStringToUri = fileOrUriStringToUri;
function uriToFilePathWhenPossible(uri) {
    if (isFileScheme(uri)) {
        return uri.fsPath;
    }
    return uri.toString();
}
exports.uriToFilePathWhenPossible = uriToFilePathWhenPossible;
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
    var _a, _b;
    return (_b = languageYmlDict[(_a = vscode.workspace.getConfiguration(constants_1.ConfigurationKey).previewLocalisation) !== null && _a !== void 0 ? _a : 'English']) !== null && _b !== void 0 ? _b : languageYmlDict['English'];
}
exports.getLanguageIdInYml = getLanguageIdInYml;
//# sourceMappingURL=vsccommon.js.map