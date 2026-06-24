import * as assert from 'assert';
import {
    Loader, ContentLoader, LoaderSession, LoadResult, LoadResultOD, mergeInLoadResult,
} from '../util/loader/loader';
import { UserError } from '../util/common';

// RecordingLoader counts loadImpl calls and can stall mid-load so concurrent load() calls
// overlap in the dedup window. disableTelemetry is forced on so the test never depends on
// telemetry state.
class RecordingLoader extends Loader<{ id: number }> {
    public loadImplCalls = 0;
    public shouldReloadReturn = false;
    private loadGate: { promise: Promise<void>; resolve(v: void): void } | undefined;

    stall() { this.loadGate = deferred<void>(); }
    release() { this.loadGate!.resolve(); this.loadGate = undefined; }

    protected async shouldReloadImpl(_session: LoaderSession): Promise<boolean> {
        return this.shouldReloadReturn;
    }

    protected async loadImpl(_session: LoaderSession): Promise<LoadResult<{ id: number }>> {
        this.loadImplCalls++;
        if (this.loadGate) {
            await this.loadGate.promise;
        }
        return { result: { id: 1 }, dependencies: [] };
    }

    constructor() {
        super();
        this.disableTelemetry = true;
    }
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
    let resolve: (v: T) => void = () => undefined;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

describe('util/loader/loader', () => {
    describe('Loader.load (caching, force, shouldReload, dedup)', () => {
        it('calls loadImpl once on first load and returns the cached result on second load', async () => {
            const loader = new RecordingLoader();
            const session = new LoaderSession(false);

            const a = await loader.load(session);
            const b = await loader.load(session);

            assert.strictEqual(loader.loadImplCalls, 1);
            assert.deepStrictEqual(a.result, { id: 1 });
            assert.deepStrictEqual(b.result, { id: 1 });
        });

        it('does not re-call loadImpl once the session is loaded, even if shouldReload says yes', async () => {
            // The first load marks the session as loaded, so subsequent calls hit the
            // `!session.isLoaded(this)` short-circuit and skip shouldReload entirely.
            const loader = new RecordingLoader();
            const session = new LoaderSession(false);

            await loader.load(session);
            loader.shouldReloadReturn = true;
            await loader.load(session);

            assert.strictEqual(loader.loadImplCalls, 1);
        });

        it('re-runs loadImpl when session.force is true on a fresh session', async () => {
            // `session.isLoaded(this)` short-circuits within a single session, so force
            // only re-fires when the caller hands in a new session that hasn't marked this
            // loader as loaded. That mirrors the real call sites: a new top-level
            // previewer invocation gets a fresh session.
            const loader = new RecordingLoader();
            const session1 = new LoaderSession(true);
            const session2 = new LoaderSession(true);

            await loader.load(session1);
            await loader.load(session2);

            assert.strictEqual(loader.loadImplCalls, 2);
        });

        it('re-runs loadImpl when shouldReloadImpl returns true on a fresh session', async () => {
            const loader = new RecordingLoader();
            loader.shouldReloadReturn = true;
            const session1 = new LoaderSession(false);
            const session2 = new LoaderSession(false);

            await loader.load(session1);
            await loader.load(session2);

            assert.strictEqual(loader.loadImplCalls, 2);
        });

        it('dedupes concurrent load() calls into a single loadImpl', async () => {
            const loader = new RecordingLoader();
            loader.stall();
            const session = new LoaderSession(false);

            const p1 = loader.load(session);
            const p2 = loader.load(session);
            // Both are awaiting the same loadImpl.
            assert.strictEqual(loader.loadImplCalls, 1);

            loader.release();
            const [r1, r2] = await Promise.all([p1, p2]);

            assert.strictEqual(loader.loadImplCalls, 1);
            assert.deepStrictEqual(r1.result, r2.result);
        });

        it('clears loadingPromise after a load even when loadImpl throws', async () => {
            class ThrowLoader extends Loader<{}> {
                protected async loadImpl(): Promise<LoadResult<{}>> {
                    throw new Error('boom');
                }
                constructor() { super(); this.disableTelemetry = true; }
            }

            const loader = new ThrowLoader();

            await assert.rejects(loader.load(new LoaderSession(false)), /boom/);

            // A second call on a fresh session must hit loadImpl again. If loadingPromise
            // had leaked across the throw, the second call would re-await the rejected
            // promise instead of starting a new one.
            await assert.rejects(loader.load(new LoaderSession(false)), /boom/);
        });
    });

    describe('LoaderSession', () => {
        it('forChild returns a session whose loadingLoader is independent', () => {
            const parent = new LoaderSession(false);
            parent.loadingLoader.push({} as Loader<unknown, unknown>);

            const child = parent.forChild();
            child.loadingLoader.push({} as Loader<unknown, unknown>);

            assert.strictEqual(parent.loadingLoader.length, 1);
            assert.strictEqual(child.loadingLoader.length, 2);
        });

        it('forChild shares loadedLoader so a child marking loaded is visible to the parent', () => {
            const parent = new LoaderSession(false);
            const loader = {} as Loader<unknown, unknown>;

            const child = parent.forChild();
            child.setLoaded(loader);

            assert.strictEqual(parent.isLoaded(loader), true);
        });

        it('throwIfCancelled does nothing when no callback is set', () => {
            const session = new LoaderSession(false);
            assert.doesNotThrow(() => session.throwIfCancelled());
        });

        it('throwIfCancelled does nothing when the callback returns false', () => {
            const session = new LoaderSession(false, () => false);
            assert.doesNotThrow(() => session.throwIfCancelled());
        });

        it('throwIfCancelled throws a UserError when the callback returns true', () => {
            const session = new LoaderSession(false, () => true);
            assert.throws(() => session.throwIfCancelled(), (e: unknown) => {
                return e instanceof UserError;
            });
        });

        it('createOrGetCachedLoader returns the same instance for the same file and type', () => {
            const session = new LoaderSession(false);
            class T extends Loader<{}> {
                constructor(_file: string) { super(); this.disableTelemetry = true; }
                protected async loadImpl(): Promise<LoadResult<{}>> { return { result: {}, dependencies: [] }; }
            }

            const a = session.createOrGetCachedLoader('/foo', T);
            const b = session.createOrGetCachedLoader('/foo', T);
            assert.strictEqual(a, b);
        });

        it('createOrGetCachedLoader replaces the cached instance when the type changes', () => {
            const session = new LoaderSession(false);
            class A extends Loader<{}> {
                constructor(_file: string) { super(); this.disableTelemetry = true; }
                protected async loadImpl(): Promise<LoadResult<{}>> { return { result: {}, dependencies: [] }; }
            }
            class B extends Loader<{}> {
                constructor(_file: string) { super(); this.disableTelemetry = true; }
                protected async loadImpl(): Promise<LoadResult<{}>> { return { result: {}, dependencies: [] }; }
            }

            const a = session.createOrGetCachedLoader('/foo', A);
            const b = session.createOrGetCachedLoader('/foo', B);
            assert.notStrictEqual(a, b);
        });

        it('shouldReload marks the loader as "checking" synchronously, then resolves to the boolean', async () => {
            const session = new LoaderSession(false);
            const d = deferred<boolean>();
            class Stub extends Loader<{}> {
                protected async shouldReloadImpl(): Promise<boolean> { return d.promise; }
                protected async loadImpl(): Promise<LoadResult<{}>> { return { result: {}, dependencies: [] }; }
                constructor() { super(); this.disableTelemetry = true; }
            }
            const stub = new Stub();

            // Kick off the async check. The state transitions to 'checking' synchronously
            // before the first `await`, so the second sync read sees the transition.
            const p = stub.shouldReload(session);
            assert.strictEqual(session.shouldReload(stub), 'checking');

            d.resolve(false);
            const result = await p;

            assert.strictEqual(result, false);
            assert.strictEqual(session.shouldReload(stub), false);
        });

        it('shouldReload returns false for a concurrent caller while the first is still checking', async () => {
            const session = new LoaderSession(false);
            const d = deferred<boolean>();
            class Stub extends Loader<{}> {
                protected async shouldReloadImpl(): Promise<boolean> { return d.promise; }
                protected async loadImpl(): Promise<LoadResult<{}>> { return { result: {}, dependencies: [] }; }
                constructor() { super(); this.disableTelemetry = true; }
            }
            const stub = new Stub();

            const p1 = stub.shouldReload(session);
            // A second concurrent caller sees the 'checking' marker and short-circuits to
            // false. This is what deduplicates expensive shouldReloadImpl work.
            const p2 = stub.shouldReload(session);

            d.resolve(true);
            const [r1, r2] = await Promise.all([p1, p2]);

            assert.strictEqual(r1, true);
            assert.strictEqual(r2, false);
        });
    });

    describe('ContentLoader (contentProvider path)', () => {
        // CapturingContentLoader records what postLoad sees for each call. readDependency
        // is configurable per instance so a single test file can exercise both branches.
        // The captured dependencies go into `postLoadCalls`, not the result type, so the
        // second generic stays `{}` and lines up with the abstract.
        class CapturingContentLoader extends ContentLoader<{ payload: string }> {
            public postLoadCalls: Array<{ content: string | undefined; deps: unknown[]; error: unknown }> = [];
            public shouldReloadReturn = false;

            constructor(file: string, provider: () => Promise<string>, readDependency: boolean) {
                super(file, provider);
                this.disableTelemetry = true;
                this.readDependency = readDependency;
            }

            public async shouldReloadImpl(_session: LoaderSession): Promise<boolean> {
                return this.shouldReloadReturn;
            }

            protected async postLoad(content: string | undefined, dependencies: unknown[], error: unknown, _session: LoaderSession): Promise<LoadResultOD<{ payload: string }>> {
                this.postLoadCalls.push({ content, deps: dependencies, error });
                return { result: { payload: content ?? '' } };
            }
        }

        it('uses the contentProvider and returns a LoadResult with the file as its only dependency', async () => {
            const loader = new CapturingContentLoader('a.txt', async () => 'hello world', false);
            const session = new LoaderSession(false);

            const result = await loader.load(session);

            assert.deepStrictEqual(result.result, { payload: 'hello world' });
            assert.deepStrictEqual(result.dependencies, ['a.txt']);
            assert.strictEqual(loader.postLoadCalls.length, 1);
        });

        it('extracts #!event:file.txt markers from content when readDependency is true', async () => {
            const loader = new CapturingContentLoader(
                'a.txt',
                async () => '#!event:foo.txt\nstuff',
                true,
            );
            await loader.load(new LoaderSession(false));

            const call = loader.postLoadCalls[0];
            assert.deepStrictEqual(call.deps, [{ type: 'event', path: 'foo.txt' }]);
        });

        it('skips dependency extraction when readDependency is false', async () => {
            const loader = new CapturingContentLoader(
                'a.txt',
                async () => '#!event:foo.txt\nstuff',
                false,
            );
            await loader.load(new LoaderSession(false));

            assert.deepStrictEqual(loader.postLoadCalls[0].deps, []);
        });

        it('re-runs postLoad when shouldReload returns true on a fresh session (content changed)', async () => {
            let payload = 'first';
            const loader = new CapturingContentLoader('a.txt', async () => payload, false);

            await loader.load(new LoaderSession(false));

            loader.shouldReloadReturn = true;
            payload = 'second';
            const result = await loader.load(new LoaderSession(false));

            assert.deepStrictEqual(result.result.payload, 'second');
            assert.strictEqual(loader.postLoadCalls.length, 2);
        });

        it('returns the cached value when shouldReload is false on a fresh session (content unchanged)', async () => {
            const loader = new CapturingContentLoader('a.txt', async () => 'same', false);
            loader.shouldReloadReturn = false;

            await loader.load(new LoaderSession(false));
            await loader.load(new LoaderSession(false));

            assert.strictEqual(loader.postLoadCalls.length, 1);
        });

        it('throws a UserError when the same file is already loading in the session (circular dependency)', async () => {
            const loader = new CapturingContentLoader('cycle.txt', async () => 'x', false);
            const session = new LoaderSession(false);
            // Simulate an ancestor loader already loading the same file. beforeLoadImpl walks
            // session.loadingLoader and rejects a self-referential load.
            session.loadingLoader.push({ file: 'cycle.txt' } as unknown as Loader<unknown, unknown>);

            await assert.rejects(loader.load(session), (e: unknown) => e instanceof UserError);
        });
    });

    describe('mergeInLoadResult', () => {
        it('flattens arrays on a single key across results', () => {
            const merged = mergeInLoadResult(
                [{ items: [1, 2] }, { items: [3, 4, 5] }, { items: [6] }],
                'items',
            );
            assert.deepStrictEqual(merged, [1, 2, 3, 4, 5, 6]);
        });

        it('returns an empty array when the key is empty everywhere', () => {
            const merged = mergeInLoadResult([{ items: [] }, { items: [] }], 'items');
            assert.deepStrictEqual(merged, []);
        });
    });
});
