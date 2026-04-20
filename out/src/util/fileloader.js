"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearDlcZipCache = clearDlcZipCache;
exports.getFilePathFromMod = getFilePathFromMod;
exports.getFilePathFromModOrHOI4 = getFilePathFromModOrHOI4;
exports.isHoiFileOpened = isHoiFileOpened;
exports.getHoiOpenedFileOriginalUri = getHoiOpenedFileOriginalUri;
exports.isHoiFileFromDlc = isHoiFileFromDlc;
exports.getHoiDlcFileOriginalUri = getHoiDlcFileOriginalUri;
exports.hoiFileExpiryToken = hoiFileExpiryToken;
exports.expiryToken = expiryToken;
exports.readFileFromPath = readFileFromPath;
exports.readFileFromModOrHOI4 = readFileFromModOrHOI4;
exports.readFileFromModOrHOI4AsJson = readFileFromModOrHOI4AsJson;
exports.listFilesFromModOrHOI4 = listFilesFromModOrHOI4;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const path = tslib_1.__importStar(require("path"));
const cache_1 = require("./cache");
const nodecommon_1 = require("./nodecommon");
const vsccommon_1 = require("./vsccommon");
const hoiparser_1 = require("../hoiformat/hoiparser");
const i18n_1 = require("./i18n");
const schema_1 = require("../hoiformat/schema");
const debug_1 = require("./debug");
const modfile_1 = require("./modfile");
const vsccommon_2 = require("./vsccommon");
const common_1 = require("./common");
const constants_1 = require("../constants");
const lodash_1 = require("lodash");
const dlcZipPathsCache = new cache_1.PromiseCache({
    factory: getDlcZipPaths,
    life: 10 * 60 * 1000,
});
const dlcPathsCache = new cache_1.PromiseCache({
    factory: getDlcPaths,
    life: 10 * 60 * 1000,
});
let dlcZipCache = null;
if (!IS_WEB_EXT) {
    // adm-zip requires fs, which doesn't work on web.
    function getDlcZip(dlcZipPath) {
        const uri = vscode.Uri.parse(dlcZipPath);
        if (uri.scheme === constants_1.Hoi4FsSchema) {
            dlcZipPath = path.join((0, vsccommon_2.getConfiguration)().installPath, (0, lodash_1.trimStart)(uri.path, '/'));
        }
        else {
            (0, vsccommon_1.ensureFileScheme)(uri);
            dlcZipPath = uri.fsPath;
        }
        const AdmZip = require('adm-zip');
        return Promise.resolve(new AdmZip(dlcZipPath));
    }
    dlcZipCache = new cache_1.PromiseCache({
        factory: getDlcZip,
        expireWhenChange: key => (0, vsccommon_1.getLastModifiedAsync)(vscode.Uri.parse(key)),
        life: 15 * 1000,
    });
}
async function clearDlcZipCache() {
    dlcPathsCache.clear();
    dlcZipPathsCache.clear();
    dlcZipCache?.clear();
}
function getFilePathFromMod(relativePath) {
    return getFilePathFromModOrHOI4(relativePath, { hoi4: false });
}
async function getFilePathFromModOrHOI4(relativePath, options) {
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    let absolutePath = undefined;
    if (options?.mod !== false) {
        // Find in opened workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
                if (await (0, vsccommon_1.isFile)(findPath)) {
                    absolutePath = findPath;
                    break;
                }
            }
            if (absolutePath !== undefined) {
                // Opened document
                const document = vscode.workspace.textDocuments.find(d => (0, vsccommon_1.isSameUri)(d.uri, absolutePath));
                if (document) {
                    return document.uri.with({ fragment: ':opened' });
                }
            }
        }
        if (absolutePath !== undefined) {
            return absolutePath;
        }
        const replacePaths = await getReplacePaths();
        if (replacePaths) {
            const relativePathDir = path.dirname(relativePath);
            for (const replacePath of replacePaths) {
                if ((0, nodecommon_1.isSamePath)(relativePathDir, replacePath)) {
                    return absolutePath;
                }
            }
        }
    }
    if (options?.hoi4 === false) {
        return absolutePath;
    }
    // Find in HOI4 install path
    const installPath = vscode.Uri.parse(constants_1.Hoi4FsSchema + ':/');
    if (!absolutePath) {
        const findPath = vscode.Uri.joinPath(installPath, relativePath);
        if (await (0, vsccommon_1.isFile)(findPath)) {
            absolutePath = findPath;
        }
    }
    // Find in HOI4 DLCs
    const conf = (0, vsccommon_2.getConfiguration)();
    if (!absolutePath && conf.loadDlcContents) {
        const dlcs = await dlcZipPathsCache.get(installPath.toString());
        if (dlcs !== null && dlcZipCache !== null) {
            for (const dlc of dlcs) {
                const dlcZip = await dlcZipCache.get(dlc.toString());
                const entry = dlcZip.getEntry(relativePath);
                if (entry !== null) {
                    return dlc.with({ fragment: relativePath });
                }
            }
        }
        const dlcFolders = await dlcPathsCache.get(installPath.toString());
        if (dlcFolders !== null) {
            for (const dlc of dlcFolders) {
                const findPath = vscode.Uri.joinPath(dlc, relativePath);
                if (await (0, vsccommon_1.isFile)(findPath)) {
                    return findPath;
                }
            }
        }
    }
    return absolutePath;
}
function isHoiFileOpened(path) {
    return path.fragment === ':opened';
}
function getHoiOpenedFileOriginalUri(path) {
    return path.with({ fragment: '' });
}
function isHoiFileFromDlc(path) {
    return path.fragment !== '' && path.path.endsWith('.zip');
}
function getHoiDlcFileOriginalUri(path) {
    return { uri: path.with({ fragment: '' }), entryPath: path.fragment };
}
async function hoiFileExpiryToken(relativePath) {
    return await expiryToken(await getFilePathFromModOrHOI4(relativePath));
    ;
}
async function expiryToken(realPath) {
    if (!realPath) {
        return '';
    }
    if (isHoiFileOpened(realPath)) {
        return realPath.toString() + '@' + Date.now();
    }
    else if (isHoiFileFromDlc(realPath)) {
        return realPath.with({ fragment: '' }).toString() + '@' + await (0, vsccommon_1.getLastModifiedAsync)(realPath);
    }
    return realPath.toString() + '@' + await (0, vsccommon_1.getLastModifiedAsync)(realPath);
}
async function readFileFromPath(realPath, relativePath) {
    if (isHoiFileOpened(realPath)) {
        const realPathWithoutOpenMark = getHoiOpenedFileOriginalUri(realPath);
        const document = (0, vsccommon_2.getDocumentByUri)(realPathWithoutOpenMark);
        if (document) {
            return [Buffer.from(document.getText()), realPath];
        }
        realPath = realPathWithoutOpenMark;
    }
    else if (realPath.fragment !== '' && realPath.path.endsWith('.zip')) {
        if (dlcZipCache !== null) {
            const { uri: dlc, entryPath: filePath } = getHoiDlcFileOriginalUri(realPath);
            const dlcZip = await dlcZipCache.get(dlc.toString());
            const entry = dlcZip.getEntry(filePath);
            if (entry !== null) {
                return [await new Promise(resolve => entry.getDataAsync(resolve)), realPath];
            }
        }
        throw new common_1.UserError("Can't find file " + relativePath);
    }
    return [await (0, vsccommon_1.readFile)(realPath), realPath];
}
async function readFileFromModOrHOI4(relativePath, options) {
    const realPath = await getFilePathFromModOrHOI4(relativePath, options);
    if (!realPath) {
        throw new common_1.UserError("Can't find file " + relativePath);
    }
    return await readFileFromPath(realPath, relativePath);
}
async function readFileFromModOrHOI4AsJson(relativePath, schema) {
    const [buffer, realPath] = await readFileFromModOrHOI4(relativePath);
    const nodes = (0, hoiparser_1.parseHoi4File)(buffer.toString(), (0, i18n_1.localize)('infile', 'In file {0}:\n', realPath));
    return (0, schema_1.convertNodeToJson)(nodes, schema);
}
async function listFilesFromModOrHOI4(relativePath, options) {
    const readFunction = options?.recursively ? vsccommon_1.readDirFilesRecursively : vsccommon_1.readDirFiles;
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    const result = [];
    if (options?.mod !== false) {
        // Find in opened workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
                if (await (0, vsccommon_1.isDirectory)(findPath)) {
                    try {
                        result.push(...await readFunction(findPath));
                    }
                    catch (e) { }
                }
            }
        }
        const replacePaths = await getReplacePaths();
        if (replacePaths) {
            for (const replacePath of replacePaths) {
                if ((0, nodecommon_1.isSamePath)(relativePath, replacePath)) {
                    return [...new Set(result)];
                }
            }
        }
    }
    if (options?.hoi4 === false) {
        return result;
    }
    // Find in HOI4 install path
    const conf = (0, vsccommon_2.getConfiguration)();
    const installPath = vscode.Uri.parse(constants_1.Hoi4FsSchema + ':/');
    {
        const findPath = vscode.Uri.joinPath(installPath, relativePath);
        if (await (0, vsccommon_1.isDirectory)(findPath)) {
            try {
                result.push(...await readFunction(findPath));
            }
            catch (e) { }
        }
    }
    // Find in HOI4 DLCs
    if (conf.loadDlcContents) {
        const dlcs = await dlcZipPathsCache.get(installPath.toString());
        if (dlcs !== null && dlcZipCache !== null) {
            for (const dlc of dlcs) {
                const dlcZip = await dlcZipCache.get(dlc.toString());
                const folderEntry = dlcZip.getEntry(relativePath);
                if (folderEntry && folderEntry.isDirectory) {
                    for (const entry of dlcZip.getEntries()) {
                        if ((0, nodecommon_1.isSamePath)(path.dirname(entry.entryName.replace(/^[\\/]/, '')), relativePath) && !entry.isDirectory) {
                            result.push(path.basename(entry.name));
                        }
                    }
                }
            }
        }
        const dlcFolders = await dlcPathsCache.get(installPath.toString());
        if (dlcFolders !== null) {
            for (const dlc of dlcFolders) {
                const findPath = vscode.Uri.joinPath(dlc, relativePath);
                if (await (0, vsccommon_1.isDirectory)(findPath)) {
                    try {
                        result.push(...await readFunction(findPath));
                    }
                    catch (e) { }
                }
            }
        }
    }
    return [...new Set(result)];
}
async function getDlcZipPaths(installPath) {
    const dlcPath = vscode.Uri.joinPath(vscode.Uri.parse(installPath), 'dlc');
    if (!await (0, vsccommon_1.isDirectory)(dlcPath)) {
        return null;
    }
    const dlcFolders = await (0, vsccommon_1.readDir)(dlcPath);
    const paths = await Promise.all(dlcFolders.map(async (dlcFolder) => {
        const dlcZipFolder = vscode.Uri.joinPath(dlcPath, dlcFolder);
        if (await (0, vsccommon_1.isDirectory)(dlcZipFolder)) {
            const files = await (0, vsccommon_1.readDir)(dlcZipFolder);
            const zipFile = files.find(file => file.endsWith('.zip'));
            if (zipFile) {
                return vscode.Uri.joinPath(dlcZipFolder, zipFile);
            }
        }
        return null;
    }));
    return paths.filter((path) => path !== null);
}
async function getDlcPaths(installPath) {
    const dlcPath = vscode.Uri.joinPath(vscode.Uri.parse(installPath), 'dlc');
    if (!await (0, vsccommon_1.isDirectory)(dlcPath)) {
        return null;
    }
    const dlcFolders = await (0, vsccommon_1.readDir)(dlcPath);
    const paths = await Promise.all(dlcFolders.map(async (dlcFolder) => {
        const dlcZipFolder = vscode.Uri.joinPath(dlcPath, dlcFolder);
        if (await (0, vsccommon_1.isDirectory)(dlcZipFolder) && dlcFolder.startsWith("dlc")) {
            return dlcZipFolder;
        }
        return null;
    }));
    return paths.filter((path) => path !== null);
}
const replacePathsCache = new cache_1.PromiseCache({
    factory: getReplacePathsFromModFile,
    expireWhenChange: key => (0, vsccommon_1.getLastModifiedAsync)(vscode.Uri.parse(key)),
    life: 60 * 1000,
});
const modFileSchema = {
    replace_path: {
        _innerType: "string",
        _type: "array",
    },
};
async function getReplacePaths() {
    const conf = (0, vsccommon_2.getConfiguration)();
    let modFile = (0, vsccommon_1.fileOrUriStringToUri)(conf.modFile);
    if (conf.modFile === "") {
        if (vscode.workspace.workspaceFolders) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                const workspaceFolderPath = workspaceFolder.uri;
                const mods = await modfile_1.workspaceModFilesCache.get(workspaceFolderPath.toString());
                if (mods.length > 0) {
                    modFile = mods[0];
                    break;
                }
            }
        }
    }
    try {
        if (modFile && await (0, vsccommon_1.isFile)(modFile)) {
            const result = await replacePathsCache.get(modFile.toString());
            (0, modfile_1.updateSelectedModFileStatus)(modFile);
            return result;
        }
    }
    catch (e) {
        (0, debug_1.error)(e);
    }
    (0, modfile_1.updateSelectedModFileStatus)(modFile, true);
    return undefined;
}
async function getReplacePathsFromModFile(absolutePath) {
    const content = (await (0, vsccommon_1.readFile)(vscode.Uri.parse(absolutePath))).toString();
    const node = (0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', absolutePath));
    const modFile = (0, schema_1.convertNodeToJson)(node, modFileSchema);
    return modFile.replace_path.filter((v) => typeof v === 'string');
}
//# sourceMappingURL=fileloader.js.map