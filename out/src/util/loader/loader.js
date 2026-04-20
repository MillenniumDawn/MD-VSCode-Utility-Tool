"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentLoader = exports.FolderLoader = exports.FileLoader = exports.Loader = exports.LoaderSession = void 0;
exports.mergeInLoadResult = mergeInLoadResult;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const path = tslib_1.__importStar(require("path"));
;
const fileloader_1 = require("../fileloader");
const debug_1 = require("../debug");
const common_1 = require("../common");
const dependency_1 = require("../dependency");
const telemetry_1 = require("../telemetry");
class LoaderSession {
    force;
    cancelled;
    loadedLoader = new Set();
    shouldLoaderReload = new Map();
    cachedLoader = {};
    loadingLoader = [];
    constructor(force, cancelled) {
        this.force = force;
        this.cancelled = cancelled;
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
        return this.shouldLoaderReload.get(loader) ?? false;
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
        const clone = { ...this };
        clone.loadingLoader = [...this.loadingLoader];
        Object.setPrototypeOf(clone, Object.getPrototypeOf(this));
        return clone;
    }
    throwIfCancelled() {
        if (this.cancelled?.call(this)) {
            throw new common_1.UserError('Load session cancelled.');
        }
    }
}
exports.LoaderSession = LoaderSession;
class Loader {
    cachedValue;
    onProgressEmitter = new vscode.EventEmitter();
    onProgress = this.onProgressEmitter.event;
    onLoadDoneEmitter = new vscode.EventEmitter();
    onLoadDone = this.onLoadDoneEmitter.event;
    loadingPromise = undefined;
    disableTelemetry = false;
    constructor() {
    }
    async load(session) {
        session = session.forChild();
        // Load each loader at most one time in one session
        if (this.cachedValue === undefined || (!session.isLoaded(this) && (session.force || await this.shouldReload(session)))) {
            const loadStartTime = Date.now();
            session.loadingLoader.push(this);
            try {
                this.beforeLoadImpl(session);
                if (this.loadingPromise === undefined) {
                    this.cachedValue = await (this.loadingPromise = this.loadImpl(session));
                }
                else {
                    this.cachedValue = await this.loadingPromise;
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
                (0, telemetry_1.sendEvent)('loader.loaddone', { loaderType: this.constructor.name }, { timeElapsed, ...this.extraMesurements(this.cachedValue) });
            }
        }
        this.onLoadDoneEmitter.fire(this.cachedValue);
        return this.cachedValue;
    }
    ;
    async shouldReload(session) {
        // Always return same value for shouldReload in one session
        const cachedShouldReload = session.shouldReload(this);
        if (cachedShouldReload === 'checking') {
            return false;
        }
        if (cachedShouldReload) {
            return true;
        }
        session.checkingShouldReload(this);
        const result = await this.shouldReloadImpl(session);
        if (result) {
            session.setShouldReload(this);
        }
        else {
            session.clearShouldReload(this);
        }
        return result;
    }
    ;
    shouldReloadImpl(session) {
        return Promise.resolve(true);
    }
    beforeLoadImpl(session) {
    }
    async fireOnProgressEvent(progress) {
        this.onProgressEmitter.fire(progress);
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    extraMesurements(result) {
        return {};
    }
    ;
}
exports.Loader = Loader;
class FileLoader extends Loader {
    file;
    expiryToken = '';
    constructor(file) {
        super();
        this.file = file;
    }
    async shouldReloadImpl(session) {
        return await (0, fileloader_1.hoiFileExpiryToken)(this.file) !== this.expiryToken;
    }
    beforeLoadImpl(session) {
        checkLoaderSessionLoadingFile(session, this.file);
    }
    async loadImpl(session) {
        this.expiryToken = await (0, fileloader_1.hoiFileExpiryToken)(this.file);
        const result = await this.loadFromFile(session);
        return {
            ...result,
            dependencies: result.dependencies ? result.dependencies : [this.file],
        };
    }
}
exports.FileLoader = FileLoader;
class FolderLoader extends Loader {
    folder;
    subLoaderConstructor;
    fileCount = 0;
    subLoaders = {};
    constructor(folder, subLoaderConstructor) {
        super();
        this.folder = folder;
        this.subLoaderConstructor = subLoaderConstructor;
    }
    async shouldReloadImpl(session) {
        const files = await (0, fileloader_1.listFilesFromModOrHOI4)(this.folder);
        if (this.fileCount !== files.length || files.some(f => !(f in this.subLoaders))) {
            return true;
        }
        return (await Promise.all(Object.values(this.subLoaders).map(l => l.shouldReload(session)))).some(v => v);
    }
    async loadImpl(session) {
        const files = await (0, fileloader_1.listFilesFromModOrHOI4)(this.folder);
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
        return this.mergeFiles(await Promise.all(fileResultPromises), session);
    }
    extraMesurements(result) {
        return { ...super.extraMesurements(result), fileCount: this.fileCount };
    }
}
exports.FolderLoader = FolderLoader;
class ContentLoader extends Loader {
    file;
    contentProvider;
    expiryToken = '';
    loaderDependencies = new LoaderDependencies();
    readDependency = true;
    constructor(file, contentProvider) {
        super();
        this.file = file;
        this.contentProvider = contentProvider;
    }
    async shouldReloadImpl(session) {
        if (this.contentProvider === undefined) {
            return await (0, fileloader_1.hoiFileExpiryToken)(this.file) !== this.expiryToken || this.loaderDependencies.shouldReload(session);
        }
        else {
            return true;
        }
    }
    beforeLoadImpl(session) {
        checkLoaderSessionLoadingFile(session, this.file);
    }
    async loadImpl(session) {
        const dependencies = [this.file];
        if (this.contentProvider === undefined) {
            this.expiryToken = await (0, fileloader_1.hoiFileExpiryToken)(this.file);
        }
        let content = undefined;
        let errorValue = undefined;
        try {
            content = this.contentProvider === undefined ?
                (await (0, fileloader_1.readFileFromModOrHOI4)(this.file))[0].toString('utf-8').replace(/^\uFEFF/, '') :
                await this.contentProvider();
        }
        catch (e) {
            (0, debug_1.error)(e);
            errorValue = e;
        }
        const dependenciesFromText = this.readDependency && content ? (0, dependency_1.getDependenciesFromText)(content) : [];
        const result = await this.postLoad(content, dependenciesFromText, errorValue, session);
        this.loaderDependencies.flip();
        return {
            ...result,
            dependencies: result.dependencies ? result.dependencies : dependencies,
        };
    }
}
exports.ContentLoader = ContentLoader;
class LoaderDependencies {
    current = {};
    newValues = {};
    async shouldReload(session) {
        // Don't use Promise.all because it will cause infinite loop when there are circular dependencies.
        for (const loader of Object.values(this.current)) {
            if (await loader.shouldReload(session)) {
                return true;
            }
        }
        return false;
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
    async loadMultiple(dependencies, session, type) {
        const loadDep = async (dep) => {
            try {
                const eventsDepLoader = this.getOrCreate(dep, k => session.createOrGetCachedLoader(k, type), type);
                return (await eventsDepLoader.load(session));
            }
            catch (e) {
                (0, debug_1.error)(e);
                return undefined;
            }
        };
        // Don't use parallel loading because A -> B -> C will cause dead lock.
        //                                    |--> C -> B
        // return (await Promise.all(dependencies.map(loadDep))).filter((v): v is Result => !!v);
        const result = [];
        for (const dependency of dependencies) {
            const value = await loadDep(dependency);
            if (value !== undefined) {
                result.push(value);
            }
        }
        return result;
    }
    flip() {
        this.current = this.newValues;
        this.newValues = {};
    }
}
function mergeInLoadResult(loadResults, key) {
    return loadResults.reduce((p, c) => p.concat(c[key]), []);
}
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