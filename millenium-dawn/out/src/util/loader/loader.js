"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeInLoadResult = exports.ContentLoader = exports.FolderLoader = exports.FileLoader = exports.Loader = exports.LoaderSession = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const path = require("path");
;
const fileloader_1 = require("../fileloader");
const debug_1 = require("../debug");
const common_1 = require("../common");
const dependency_1 = require("../dependency");
const telemetry_1 = require("../telemetry");
class LoaderSession {
    constructor(force, cancelled) {
        this.force = force;
        this.cancelled = cancelled;
        this.loadedLoader = new Set();
        this.shouldLoaderReload = new Map();
        this.cachedLoader = {};
        this.loadingLoader = [];
    }
    isLoaded(loader) {
        return this.loadedLoader.has(loader);
    }
    setLoaded(loader) {
        this.loadedLoader.add(loader);
    }
    checkingShouldReload(loader) {
        this.shouldLoaderReload.set(loader, 'checking');
    }
    setShouldReload(loader) {
        this.shouldLoaderReload.set(loader, true);
    }
    clearShouldReload(loader) {
        this.shouldLoaderReload.delete(loader);
    }
    shouldReload(loader) {
        var _a;
        return (_a = this.shouldLoaderReload.get(loader)) !== null && _a !== void 0 ? _a : false;
    }
    createOrGetCachedLoader(file, loaderType) {
        const cachedLoader = this.cachedLoader[file];
        if (cachedLoader instanceof loaderType) {
            return cachedLoader;
        }
        else {
            const loader = this.cachedLoader[file] = new loaderType(file);
            return loader;
        }
    }
    forChild() {
        const clone = Object.assign({}, this);
        clone.loadingLoader = [...this.loadingLoader];
        Object.setPrototypeOf(clone, Object.getPrototypeOf(this));
        return clone;
    }
    throwIfCancelled() {
        var _a;
        if ((_a = this.cancelled) === null || _a === void 0 ? void 0 : _a.call(this)) {
            throw new common_1.UserError('Load session cancelled.');
        }
    }
}
exports.LoaderSession = LoaderSession;
class Loader {
    constructor() {
        this.onProgressEmitter = new vscode.EventEmitter();
        this.onProgress = this.onProgressEmitter.event;
        this.onLoadDoneEmitter = new vscode.EventEmitter();
        this.onLoadDone = this.onLoadDoneEmitter.event;
        this.loadingPromise = undefined;
        this.disableTelemetry = false;
    }
    load(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            session = session.forChild();
            // Load each loader at most one time in one session
            if (this.cachedValue === undefined || (!session.isLoaded(this) && (session.force || (yield this.shouldReload(session))))) {
                const loadStartTime = Date.now();
                session.loadingLoader.push(this);
                try {
                    this.beforeLoadImpl(session);
                    if (this.loadingPromise === undefined) {
                        this.cachedValue = yield (this.loadingPromise = this.loadImpl(session));
                    }
                    else {
                        this.cachedValue = yield this.loadingPromise;
                    }
                    session.setLoaded(this);
                }
                finally {
                    this.loadingPromise = undefined;
                    if (session.loadingLoader.pop() !== this) {
                        throw new Error('loadingLoader corrupted.');
                    }
                }
                const timeElapsed = Date.now() - loadStartTime;
                if (timeElapsed > 500 && !this.disableTelemetry) {
                    (0, telemetry_1.sendEvent)('loader.loaddone', { loaderType: this.constructor.name }, Object.assign({ timeElapsed }, this.extraMesurements(this.cachedValue)));
                }
            }
            this.onLoadDoneEmitter.fire(this.cachedValue);
            return this.cachedValue;
        });
    }
    ;
    shouldReload(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // Always return same value for shouldReload in one session
            const cachedShouldReload = session.shouldReload(this);
            if (cachedShouldReload === 'checking') {
                return false;
            }
            if (cachedShouldReload) {
                return true;
            }
            session.checkingShouldReload(this);
            const result = yield this.shouldReloadImpl(session);
            if (result) {
                session.setShouldReload(this);
            }
            else {
                session.clearShouldReload(this);
            }
            return result;
        });
    }
    ;
    shouldReloadImpl(session) {
        return Promise.resolve(true);
    }
    beforeLoadImpl(session) {
    }
    fireOnProgressEvent(progress) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.onProgressEmitter.fire(progress);
            yield new Promise(resolve => setTimeout(resolve, 0));
        });
    }
    extraMesurements(result) {
        return {};
    }
    ;
}
exports.Loader = Loader;
class FileLoader extends Loader {
    constructor(file) {
        super();
        this.file = file;
        this.expiryToken = '';
    }
    shouldReloadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return (yield (0, fileloader_1.hoiFileExpiryToken)(this.file)) !== this.expiryToken;
        });
    }
    beforeLoadImpl(session) {
        checkLoaderSessionLoadingFile(session, this.file);
    }
    loadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.expiryToken = yield (0, fileloader_1.hoiFileExpiryToken)(this.file);
            const result = yield this.loadFromFile(session);
            return Object.assign(Object.assign({}, result), { dependencies: result.dependencies ? result.dependencies : [this.file] });
        });
    }
}
exports.FileLoader = FileLoader;
class FolderLoader extends Loader {
    constructor(folder, subLoaderConstructor) {
        super();
        this.folder = folder;
        this.subLoaderConstructor = subLoaderConstructor;
        this.fileCount = 0;
        this.subLoaders = {};
    }
    shouldReloadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const files = yield (0, fileloader_1.listFilesFromModOrHOI4)(this.folder);
            if (this.fileCount !== files.length || files.some(f => !(f in this.subLoaders))) {
                return true;
            }
            return (yield Promise.all(Object.values(this.subLoaders).map(l => l.shouldReload(session)))).some(v => v);
        });
    }
    loadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const files = yield (0, fileloader_1.listFilesFromModOrHOI4)(this.folder);
            this.fileCount = files.length;
            const subLoaders = this.subLoaders;
            const newSubLoaders = {};
            const fileResultPromises = [];
            for (const file of files) {
                let subLoader = subLoaders[file];
                if (!subLoader) {
                    subLoader = new this.subLoaderConstructor(path.join(this.folder, file));
                    subLoader.disableTelemetry = true;
                    subLoader.onProgress(e => this.onProgressEmitter.fire(e));
                }
                fileResultPromises.push(subLoader.load(session));
                newSubLoaders[file] = subLoader;
            }
            this.subLoaders = newSubLoaders;
            return this.mergeFiles(yield Promise.all(fileResultPromises), session);
        });
    }
    extraMesurements(result) {
        return Object.assign(Object.assign({}, super.extraMesurements(result)), { fileCount: this.fileCount });
    }
}
exports.FolderLoader = FolderLoader;
class ContentLoader extends Loader {
    constructor(file, contentProvider) {
        super();
        this.file = file;
        this.contentProvider = contentProvider;
        this.expiryToken = '';
        this.loaderDependencies = new LoaderDependencies();
        this.readDependency = true;
    }
    shouldReloadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this.contentProvider === undefined) {
                return (yield (0, fileloader_1.hoiFileExpiryToken)(this.file)) !== this.expiryToken || this.loaderDependencies.shouldReload(session);
            }
            else {
                return true;
            }
        });
    }
    beforeLoadImpl(session) {
        checkLoaderSessionLoadingFile(session, this.file);
    }
    loadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const dependencies = [this.file];
            if (this.contentProvider === undefined) {
                this.expiryToken = yield (0, fileloader_1.hoiFileExpiryToken)(this.file);
            }
            let content = undefined;
            let errorValue = undefined;
            try {
                content = this.contentProvider === undefined ?
                    (yield (0, fileloader_1.readFileFromModOrHOI4)(this.file))[0].toString('utf-8').replace(/^\uFEFF/, '') :
                    yield this.contentProvider();
            }
            catch (e) {
                (0, debug_1.error)(e);
                errorValue = e;
            }
            const dependenciesFromText = this.readDependency && content ? (0, dependency_1.getDependenciesFromText)(content) : [];
            const result = yield this.postLoad(content, dependenciesFromText, errorValue, session);
            this.loaderDependencies.flip();
            return Object.assign(Object.assign({}, result), { dependencies: result.dependencies ? result.dependencies : dependencies });
        });
    }
}
exports.ContentLoader = ContentLoader;
class LoaderDependencies {
    constructor() {
        this.current = {};
        this.newValues = {};
    }
    shouldReload(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // Don't use Promise.all because it will cause infinite loop when there are circular dependencies.
            for (const loader of Object.values(this.current)) {
                if (yield loader.shouldReload(session)) {
                    return true;
                }
            }
            return false;
        });
    }
    getOrCreate(key, factory, type) {
        const loader = this.current[key];
        if (loader && loader instanceof type) {
            this.newValues[key] = loader;
            return loader;
        }
        else {
            const newLoader = factory(key);
            this.newValues[key] = newLoader;
            return newLoader;
        }
    }
    loadMultiple(dependencies, session, type) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const loadDep = (dep) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                try {
                    const eventsDepLoader = this.getOrCreate(dep, k => session.createOrGetCachedLoader(k, type), type);
                    return (yield eventsDepLoader.load(session));
                }
                catch (e) {
                    (0, debug_1.error)(e);
                    return undefined;
                }
            });
            // Don't use parallel loading because A -> B -> C will cause dead lock.
            //                                    |--> C -> B
            // return (await Promise.all(dependencies.map(loadDep))).filter((v): v is Result => !!v);
            const result = [];
            for (const dependency of dependencies) {
                const value = yield loadDep(dependency);
                if (value !== undefined) {
                    result.push(value);
                }
            }
            return result;
        });
    }
    flip() {
        this.current = this.newValues;
        this.newValues = {};
    }
}
function mergeInLoadResult(loadResults, key) {
    return loadResults.reduce((p, c) => p.concat(c[key]), []);
}
exports.mergeInLoadResult = mergeInLoadResult;
function checkLoaderSessionLoadingFile(session, file) {
    const length = session.loadingLoader.length - 1;
    for (let i = 0; i < length; i++) {
        const loader = session.loadingLoader[i];
        if ('file' in loader && loader.file === file) {
            throw new common_1.UserError('Circular dependency when loading file. Loading loaders: ' + session.loadingLoader);
        }
    }
}
//# sourceMappingURL=loader.js.map