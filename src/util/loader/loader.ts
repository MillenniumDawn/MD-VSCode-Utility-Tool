import * as vscode from "vscode";
import * as path from "path";
import {
	hoiFileExpiryToken,
	listFilesFromModOrHOI4,
	readFileFromModOrHOI4,
} from "../fileloader";
import { error } from "../debug";
import { mapLimit, UserError } from "../common";
import { Dependency, getDependenciesFromText } from "../dependency";
import { sendEvent } from "../telemetry";
export { Dependency } from "../dependency";

export class LoaderSession {
	private loadedLoader: Set<Loader<unknown, unknown>> = new Set();
	private shouldLoaderReload: Map<
		Loader<unknown, unknown>,
		boolean | "checking"
	> = new Map();
	private cachedLoader: Record<string, Loader<unknown, unknown>> = {};
	public loadingLoader: Loader<unknown, unknown>[] = [];

	constructor(
		public force: boolean,
		private cancelled?: () => boolean,
	) {}

	public isLoaded(loader: Loader<unknown, unknown>): boolean {
		return this.loadedLoader.has(loader);
	}

	public setLoaded(loader: Loader<unknown, unknown>) {
		this.loadedLoader.add(loader);
	}

	/** Names of every loader this session has completed, for debug output. */
	public loadedLoaderNames(): string[] {
		return Array.from(this.loadedLoader, (loader) => loader.toString());
	}

	public checkingShouldReload(loader: Loader<unknown, unknown>) {
		this.shouldLoaderReload.set(loader, "checking");
	}

	public setShouldReload(loader: Loader<unknown, unknown>, value = true) {
		this.shouldLoaderReload.set(loader, value);
	}

	/** `undefined` until the loader has been checked in this session. */
	public shouldReload(
		loader: Loader<unknown, unknown>,
	): boolean | "checking" | undefined {
		return this.shouldLoaderReload.get(loader);
	}

	public createOrGetCachedLoader<R extends Loader<unknown, unknown>>(
		file: string,
		loaderType: { new (file: string): R },
	): R {
		const cachedLoader = this.cachedLoader[file];
		if (cachedLoader instanceof loaderType) {
			return cachedLoader;
		} else {
			const loader = (this.cachedLoader[file] = new loaderType(file));
			return loader;
		}
	}

	public forChild(): LoaderSession {
		// Built field by field rather than spread-then-setPrototypeOf: this runs once per
		// Loader.load(), and swapping an object's prototype after construction puts it in V8's
		// slow dictionary mode for the rest of its life.
		const clone = Object.create(LoaderSession.prototype) as LoaderSession;
		clone.loadedLoader = this.loadedLoader;
		clone.shouldLoaderReload = this.shouldLoaderReload;
		clone.cachedLoader = this.cachedLoader;
		clone.loadingLoader = [...this.loadingLoader];
		clone.force = this.force;
		clone.cancelled = this.cancelled;
		return clone;
	}

	public throwIfCancelled(): void {
		if (this.cancelled?.call(this)) {
			throw new UserError("Load session cancelled.");
		}
	}
}

export type LoadResult<T, E = {}> = { result: T; dependencies: string[] } & E;
export type LoadResultOD<T, E = {}> = Omit<LoadResult<T, E>, "dependencies"> &
	Partial<Pick<LoadResult<T, E>, "dependencies">> &
	E;
export abstract class Loader<T, E = {}> {
	private cachedValue: LoadResult<T, E> | undefined;

	protected onProgressEmitter = new vscode.EventEmitter<string>();
	public onProgress = this.onProgressEmitter.event;
	protected onLoadDoneEmitter = new vscode.EventEmitter<LoadResult<T, E>>();
	public onLoadDone = this.onLoadDoneEmitter.event;

	private loadingPromise: Promise<LoadResult<T, E>> | undefined = undefined;

	public disableTelemetry = false;

	constructor() {}

	async load(session: LoaderSession): Promise<LoadResult<T, E>> {
		session = session.forChild();

		// Load each loader at most one time in one session
		if (
			this.cachedValue === undefined ||
			(!session.isLoaded(this) &&
				(session.force || (await this.shouldReload(session))))
		) {
			const loadStartTime = Date.now();

			session.loadingLoader.push(this);
			try {
				this.beforeLoadImpl(session);
				if (this.loadingPromise === undefined) {
					this.cachedValue = await (this.loadingPromise =
						this.loadImpl(session));
				} else {
					this.cachedValue = await this.loadingPromise;
				}
				session.setLoaded(this);
			} finally {
				this.loadingPromise = undefined;
				if (session.loadingLoader.pop() !== this) {
					throw new Error("loadingLoader corrupted.");
				}
			}

			const timeElapsed = Date.now() - loadStartTime;

			if (timeElapsed > 500 && !this.disableTelemetry) {
				sendEvent(
					"loader.loaddone",
					{ loaderType: this.constructor.name },
					{ timeElapsed, ...this.extraMeasurements(this.cachedValue) },
				);
			}
		} else if (session.shouldReload(this) === false) {
			// A settled "no" keeps the cached value for the rest of the session. A caller that only
			// saw "checking" is not marked: that check may still end in a reload.
			session.setLoaded(this);
		}

		this.onLoadDoneEmitter.fire(this.cachedValue);
		return this.cachedValue;
	}

	public async shouldReload(session: LoaderSession): Promise<boolean> {
		// Always return same value for shouldReload in one session
		const cachedShouldReload = session.shouldReload(this);
		if (cachedShouldReload === "checking") {
			return false;
		}
		if (cachedShouldReload !== undefined) {
			return cachedShouldReload;
		}

		session.checkingShouldReload(this);
		const result = await this.shouldReloadImpl(session);
		session.setShouldReload(this, result);

		return result;
	}

	protected shouldReloadImpl(_session: LoaderSession): Promise<boolean> {
		return Promise.resolve(true);
	}

	protected beforeLoadImpl(_session: LoaderSession): void {}

	protected async fireOnProgressEvent(progress: string): Promise<void> {
		this.onProgressEmitter.fire(progress);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	protected extraMeasurements(
		_result: LoadResult<T, E>,
	): Record<string, number> {
		return {};
	}

	protected abstract loadImpl(
		session: LoaderSession,
	): Promise<LoadResult<T, E>>;
}

export abstract class FileLoader<T, E = {}> extends Loader<T, E> {
	private expiryToken: string = "";

	constructor(public file: string) {
		super();
	}

	public async shouldReloadImpl(_session: LoaderSession): Promise<boolean> {
		return (await hoiFileExpiryToken(this.file)) !== this.expiryToken;
	}

	protected beforeLoadImpl(session: LoaderSession): void {
		checkLoaderSessionLoadingFile(session, this.file);
	}

	protected async loadImpl(session: LoaderSession): Promise<LoadResult<T, E>> {
		this.expiryToken = await hoiFileExpiryToken(this.file);

		const result = await this.loadFromFile(session);

		return {
			...result,
			dependencies: result.dependencies ? result.dependencies : [this.file],
		};
	}

	protected abstract loadFromFile(
		session: LoaderSession,
	): Promise<LoadResultOD<T, E>>;
}

/**
 * How many files a folder loads at once. Parsing is synchronous, so starting every file together
 * only bought concurrency on the read while holding every buffer and parse tree live at the same
 * time -- around a thousand of them for `history/states` in a large mod.
 */
export const FOLDER_LOAD_CONCURRENCY = 8;

/** A file in the folder whose loader rejected; the folder still loads without it. */
export interface FolderFileFailure {
	file: string;
	error: unknown;
}

export abstract class FolderLoader<T, TFile, E = {}, EFile = {}> extends Loader<
	T,
	E
> {
	private fileCount: number = 0;
	private subLoaders: Record<string, FileLoader<TFile, EFile>> = {};

	constructor(
		public folder: string,
		private subLoaderConstructor: {
			new (file: string): FileLoader<TFile, EFile>;
		},
	) {
		super();
	}

	public async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		const files = await listFilesFromModOrHOI4(this.folder);
		if (
			this.fileCount !== files.length ||
			files.some((f) => !(f in this.subLoaders))
		) {
			return true;
		}

		return (
			await mapLimit(
				Object.values(this.subLoaders),
				FOLDER_LOAD_CONCURRENCY,
				(l) => l.shouldReload(session),
			)
		).some((v) => v);
	}

	protected async loadImpl(session: LoaderSession): Promise<LoadResult<T, E>> {
		const files = await listFilesFromModOrHOI4(this.folder);
		this.fileCount = files.length;

		const subLoaders = this.subLoaders;
		const newSubLoaders: Record<string, FileLoader<TFile, EFile>> = {};

		for (const file of files) {
			let subLoader = subLoaders[file];
			if (!subLoader) {
				subLoader = new this.subLoaderConstructor(path.join(this.folder, file));
				subLoader.disableTelemetry = true;
				subLoader.onProgress((e) => this.onProgressEmitter.fire(e));
			}

			newSubLoaders[file] = subLoader;
		}

		this.subLoaders = newSubLoaders;

		const failures: FolderFileFailure[] = [];
		const outcomes = await mapLimit(
			files,
			FOLDER_LOAD_CONCURRENCY,
			async (file) => {
				const subLoader = newSubLoaders[file]!;
				try {
					return await subLoader.load(session);
				} catch (e) {
					// A cancelled session is the same error class as a missing file, so the
					// session is asked rather than the error. Anything else is one file's
					// problem, not the folder's.
					session.throwIfCancelled();
					error(e);
					failures.push({ file: subLoader.file, error: e });
					return undefined;
				}
			},
		);

		const fileResults = outcomes.filter(
			(r): r is LoadResult<TFile, EFile> => r !== undefined,
		);

		return this.mergeFiles(fileResults, session, failures);
	}

	protected extraMeasurements(result: LoadResult<T, E>) {
		return { ...super.extraMeasurements(result), fileCount: this.fileCount };
	}

	protected abstract mergeFiles(
		fileResults: LoadResult<TFile, EFile>[],
		session: LoaderSession,
		failures: FolderFileFailure[],
	): Promise<LoadResult<T, E>>;
}

export abstract class ContentLoader<T, E = {}> extends Loader<T, E> {
	private expiryToken: string = "";
	protected loaderDependencies = new LoaderDependencies();
	protected readDependency = true;
	// The text the last load saw, kept whole. Comparing strings is a length check and a memcmp,
	// where hashing walked every character of the document on every render, changed or not.
	private lastContent: string | undefined = undefined;
	private pendingContent: string | undefined = undefined;

	constructor(
		public file: string,
		private contentProvider?: () => Promise<string>,
	) {
		super();
	}

	public async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		if (this.contentProvider === undefined) {
			return (
				(await hoiFileExpiryToken(this.file)) !== this.expiryToken ||
				this.loaderDependencies.shouldReload(session)
			);
		}
		// Peek at in-memory content; store it to avoid a second call in loadImpl
		const content = await this.contentProvider();
		const depsChanged = await this.loaderDependencies.shouldReload(session);
		if (content === this.lastContent && !depsChanged) {
			return false;
		}
		this.pendingContent = content;
		this.lastContent = content;
		return true;
	}

	protected beforeLoadImpl(session: LoaderSession): void {
		checkLoaderSessionLoadingFile(session, this.file);
	}

	protected async loadImpl(session: LoaderSession): Promise<LoadResult<T, E>> {
		const dependencies: string[] = [this.file];

		if (this.contentProvider === undefined) {
			this.expiryToken = await hoiFileExpiryToken(this.file);
		}

		let content: string | undefined = undefined;
		let errorValue: unknown = undefined;
		try {
			if (this.contentProvider === undefined) {
				content = (await readFileFromModOrHOI4(this.file))[0]
					.toString("utf-8")
					.replace(/^\uFEFF/, "");
			} else {
				content = this.pendingContent ?? (await this.contentProvider());
				// The first load never goes through shouldReloadImpl, so it records the text
				// itself; otherwise the next check had nothing to compare against and every
				// second render reloaded an unchanged document.
				this.lastContent = content;
			}
			this.pendingContent = undefined;
		} catch (e) {
			this.pendingContent = undefined;
			error(e);
			errorValue = e;
		}

		const dependenciesFromText =
			this.readDependency && content ? getDependenciesFromText(content) : [];
		const result = await this.postLoad(
			content,
			dependenciesFromText,
			errorValue,
			session,
		);
		this.loaderDependencies.flip();

		return {
			...result,
			dependencies: result.dependencies ? result.dependencies : dependencies,
		};
	}

	protected abstract postLoad(
		content: string | undefined,
		dependencies: Dependency[],
		error: unknown,
		session: LoaderSession,
	): Promise<LoadResultOD<T, E>>;
}

type PromiseValue<P> = P extends Promise<infer K> ? K : P;
class LoaderDependencies {
	public current: Record<string, Loader<unknown, unknown>> = {};
	private newValues: Record<string, Loader<unknown, unknown>> = {};

	public async shouldReload(session: LoaderSession): Promise<boolean> {
		// Don't use Promise.all because it will cause infinite loop when there are circular dependencies.
		for (const loader of Object.values(this.current)) {
			if (await loader.shouldReload(session)) {
				return true;
			}
		}
		return false;
	}

	public getOrCreate<R extends Loader<unknown, unknown>>(
		key: string,
		factory: (key: string) => R,
		type: { new (file: string): R },
	): R {
		const loader = this.current[key];
		if (loader && loader instanceof type) {
			this.newValues[key] = loader;
			return loader;
		} else {
			const newLoader = factory(key);
			this.newValues[key] = newLoader;
			return newLoader;
		}
	}

	public async loadMultiple<R extends Loader<unknown, unknown>>(
		dependencies: string[],
		session: LoaderSession,
		type: { new (file: string): R },
	) {
		type Result = PromiseValue<ReturnType<R["load"]>>;
		const loadDep = async (dep: string) => {
			try {
				const eventsDepLoader = this.getOrCreate(
					dep,
					(k) => session.createOrGetCachedLoader(k, type),
					type,
				);
				return (await eventsDepLoader.load(session)) as PromiseValue<
					ReturnType<R["load"]>
				>;
			} catch (e) {
				error(e);
				return undefined;
			}
		};

		// Don't use parallel loading because A -> B -> C will cause dead lock.
		//                                    |--> C -> B
		// return (await Promise.all(dependencies.map(loadDep))).filter((v): v is Result => !!v);
		const result: Result[] = [];
		for (const dependency of dependencies) {
			const value = await loadDep(dependency);
			if (value !== undefined) {
				result.push(value);
			}
		}

		return result;
	}

	public flip() {
		this.current = this.newValues;
		this.newValues = {};
	}
}

export function mergeInLoadResult<
	K extends string,
	T extends { [k in K]: unknown[] },
>(loadResults: T[], key: K): T[K] {
	// One array, pushed into. `reduce` with `concat` allocated a fresh array holding everything so
	// far on every step, so merging n results cost n^2/2 element copies -- and the world map merges
	// one result per state file, of which a large mod has around a thousand.
	const merged: unknown[] = [];
	for (const loadResult of loadResults) {
		const values = loadResult[key];
		for (const value of values) {
			merged.push(value);
		}
	}
	return merged as T[K];
}

function checkLoaderSessionLoadingFile(session: LoaderSession, file: string) {
	const length = session.loadingLoader.length - 1;
	for (let i = 0; i < length; i++) {
		const loader = session.loadingLoader[i];
		if (
			(loader instanceof FileLoader || loader instanceof ContentLoader) &&
			loader.file === file
		) {
			throw new UserError(
				"Circular dependency when loading file. Loading loaders: " +
					session.loadingLoader,
			);
		}
	}
}
