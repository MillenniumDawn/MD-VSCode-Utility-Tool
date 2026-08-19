// DDS/TGA -> PNG decode abstraction. On the desktop (node) build it offloads decoding to a pool of
// long-lived worker_threads workers so a focus tree full of DDS icons doesn't stall the extension
// host. The pool grows on demand: a single DDS view spawns one worker, while a render that queues
// many decodes at once (a focus tree) widens the pool so the CPU-bound DDS/TGA->PNG conversion
// parallelizes across cores instead of serializing on one thread. On the web build (or when no
// worker can be spawned, after every worker crashes, or whenever a queued job comes back failed) it
// falls back to a synchronous decode that is byte-for-byte identical to the original inline getImage
// path.
//
// worker_threads and every other node-only require live strictly inside `if (!IS_WEB_EXT)` blocks
// (mirroring fileloader.ts) so terser dead-code-eliminates them from the web bundle.
import * as path from "path";
import { PNG } from "pngjs";
import { DDS } from "./dds";
import { ddsToPng, tgaToPng } from "./converter";
import { UserError } from "../common";
import { debug, error } from "../debug";
import { getConfiguration } from "../vsccommon";

export interface DecodedImage {
	pngBuffer: Buffer;
	width: number;
	height: number;
}

type WorkerInstance = import("worker_threads").Worker;

interface WorkerResponse {
	id: number;
	png?: ArrayBuffer;
	width?: number;
	height?: number;
	error?: { message: string; name: string };
}

interface PendingJob {
	resolve: (value: DecodedImage) => void;
	reject: (reason: unknown) => void;
	state: WorkerState;
}

interface WorkerState {
	worker: WorkerInstance;
	inFlight: number;
}

// The guaranteed synchronous fallback. Identical to the original inline decode in getImage; the DDS
// path deliberately keeps `buffer.buffer`/`buffer.byteOffset` so a pooled Node Buffer is read from
// the correct offset.
export function decodeImageToPngSync(
	buffer: Buffer,
	kind: "dds" | "tga",
): DecodedImage {
	let png: PNG;
	if (kind === "dds") {
		png = ddsToPng(DDS.parse(buffer.buffer as ArrayBuffer, buffer.byteOffset));
	} else {
		png = tgaToPng(buffer);
	}

	const pngBuffer = PNG.sync.write(png);
	return { pngBuffer, width: png.width, height: png.height };
}

const pendingJobs = new Map<number, PendingJob>();
let nextJobId = 1;
const workers: WorkerState[] = [];
// Once every worker has failed to spawn or crashed we never respawn; every subsequent decode uses the
// sync fallback (see the brief). In-flight jobs at crash time are rejected.
let workerUnavailable = false;
// In the bundle __dirname is dist/, next to extension.js, where the imageWorker entry is emitted.
const defaultWorkerPath = path.join(__dirname, "imageWorker.js");
let workerPath = defaultWorkerPath;

// Default cap on concurrent decode workers (the mdHoi4Utilities.imageDecodeWorkers setting, which the
// user can raise or lower). Each worker is a full V8 isolate holding its own PNG buffers, so the pool
// is bounded; it only ever reaches this many under a heavy multi-decode render.
const WORKER_POOL_SIZE = 4;
// Absolute ceiling so a mis-set value can't hand the pool unbounded CPU access.
const MAX_WORKER_POOL_SIZE = 16;

// Clamp the user's imageDecodeWorkers setting into the valid range: at least 1, at most
// MAX_WORKER_POOL_SIZE, defaulting to WORKER_POOL_SIZE when unset. Pure so it is unit-testable.
export function resolveWorkerPoolSize(configured: number | undefined): number {
	return Math.min(
		Math.max(1, configured ?? WORKER_POOL_SIZE),
		MAX_WORKER_POOL_SIZE,
	);
}

// Runtime pool size: the configured cap, clamped to [1, MAX_WORKER_POOL_SIZE]. Stays 1 on the web
// build (no worker).
let workerPoolSize = 1;

let ensureWorkers: (() => WorkerState[] | null) | null = null;
let spawnWorker: (() => WorkerState | null) | null = null;

if (!IS_WEB_EXT) {
	workerPoolSize = resolveWorkerPoolSize(getConfiguration().imageDecodeWorkers);

	spawnWorker = function spawnWorkerImpl(): WorkerState | null {
		try {
			const { Worker } =
				require("worker_threads") as typeof import("worker_threads");
			// stderr: true keeps a worker that fails to even load its entry file (e.g. a stale
			// workerPath) from dumping its raw startup error onto the extension host's real stderr;
			// onWorkerError/onWorkerExit already log that same failure through error(), so the
			// redirected stream is just drained and dropped here to avoid a duplicate raw dump.
			const spawned = new Worker(workerPath, { stderr: true });
			spawned.stderr.on("data", () => undefined);
			const state: WorkerState = { worker: spawned, inFlight: 0 };
			spawned.on("message", (response: WorkerResponse) =>
				onWorkerMessage(state, response),
			);
			spawned.on("error", (e: unknown) => onWorkerError(state, e));
			spawned.on("exit", (code: number) => onWorkerExit(state, code));
			workers.push(state);
			debug("[imagedecoder] spawned image decode worker: " + workerPath);
			return state;
		} catch (e) {
			error(e);
			return null;
		}
	};

	ensureWorkers = function ensureWorkersImpl(): WorkerState[] | null {
		if (workerUnavailable) {
			return null;
		}
		if (workers.length > 0) {
			return workers;
		}
		const first = spawnWorker!();
		if (!first) {
			disableWorker();
			return null;
		}
		return workers;
	};
}

function onWorkerMessage(state: WorkerState, response: WorkerResponse): void {
	state.inFlight = Math.max(0, state.inFlight - 1);
	const job = pendingJobs.get(response.id);
	if (!job) {
		return;
	}

	pendingJobs.delete(response.id);
	if (response.error) {
		job.reject(reviveError(response.error));
	} else if (response.png) {
		// Buffer.from(ArrayBuffer) wraps the transferred buffer without copying.
		job.resolve({
			pngBuffer: Buffer.from(response.png),
			width: response.width ?? 0,
			height: response.height ?? 0,
		});
	} else {
		job.reject(new Error("image decode worker returned an empty response"));
	}
}

function onWorkerError(state: WorkerState, e: unknown): void {
	error(e);
	failWorkerJobs(state, e instanceof Error ? e : new Error(String(e)));
	removeWorker(state);
}

function onWorkerExit(state: WorkerState, code: number): void {
	removeWorker(state);
	if (state.inFlight > 0) {
		const reason = new Error(
			"image decode worker exited (code " + code + ") with jobs in flight",
		);
		error(reason);
		failWorkerJobs(state, reason);
	}
}

function removeWorker(state: WorkerState): void {
	const idx = workers.indexOf(state);
	if (idx >= 0) {
		workers.splice(idx, 1);
	}
	if (workers.length === 0) {
		disableWorker();
	}
}

function disableWorker(): void {
	workerUnavailable = true;
	for (const state of workers) {
		try {
			state.worker.removeAllListeners();
			void state.worker.terminate();
		} catch (e) {
			// The worker is already gone; nothing to clean up.
		}
	}
	workers.length = 0;
}

function failWorkerJobs(state: WorkerState, reason: Error): void {
	for (const [id, job] of pendingJobs) {
		if (job.state === state) {
			pendingJobs.delete(id);
			job.reject(reason);
		}
	}
}

function reviveError(info: { message: string; name: string }): Error {
	// Preserve UserError identity so getImage keeps distinguishing user errors from real failures.
	if (info.name === "UserError") {
		return new UserError(info.message);
	}
	const e = new Error(info.message);
	e.name = info.name;
	return e;
}

// Least-busy worker, growing the pool when every worker is saturated and the cap isn't reached. A
// single decode therefore spawns just one worker; a burst of concurrent decodes widens the pool so
// the CPU-bound conversions run in parallel.
function pickOrGrowWorker(): WorkerState {
	if (workers.length === 0) {
		throw new Error("no image decode worker available");
	}
	const firstWorker = workers[0];
	if (firstWorker === undefined) {
		throw new Error("no image decode worker available");
	}
	let best = firstWorker;
	let allBusy = true;
	for (const state of workers) {
		if (state.inFlight < best.inFlight) {
			best = state;
		}
		if (state.inFlight === 0) {
			allBusy = false;
		}
	}
	if (allBusy && workers.length < workerPoolSize && spawnWorker) {
		const spawned = spawnWorker();
		if (spawned) {
			return spawned;
		}
	}
	return best;
}

function postJob(buffer: Buffer, kind: "dds" | "tga"): Promise<DecodedImage> {
	return new Promise<DecodedImage>((resolve, reject) => {
		const id = nextJobId++;
		let state: WorkerState;
		try {
			state = pickOrGrowWorker();
		} catch (e) {
			reject(e);
			return;
		}
		pendingJobs.set(id, { resolve, reject, state });
		try {
			// Copy into a private ArrayBuffer before transferring: the source Buffer is shared and
			// cached in fileContentCache, so it must never be detached. The copy is the only cost
			// paid on the main thread; the heavy decode and PNG encode run in the worker.
			const payload = buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength,
			) as ArrayBuffer;
			state.inFlight++;
			state.worker.postMessage({ id, kind, buffer: payload }, [payload]);
		} catch (e) {
			pendingJobs.delete(id);
			state.inFlight = Math.max(0, state.inFlight - 1);
			reject(e);
		}
	});
}

export async function decodeImageToPng(
	buffer: Buffer,
	kind: "dds" | "tga",
): Promise<DecodedImage> {
	if (!IS_WEB_EXT) {
		const pool = ensureWorkers ? ensureWorkers() : null;
		if (pool && pool.length > 0) {
			try {
				return await postJob(buffer, kind);
			} catch (e) {
				// `new Worker` reports a missing entry file asynchronously, so a pool that can never
				// work still looks spawned; without this the whole first render decodes to nothing and
				// getImage caches that undefined for the image cache's full life.
				error(e);
				return decodeImageToPngSync(buffer, kind);
			}
		}
	}

	return decodeImageToPngSync(buffer, kind);
}

// The pool holds up to imageDecodeWorkers threads for the life of the extension host and nothing
// else releases them, so activate() disposes it on shutdown.
export function disposeImageDecodeWorkers(): void {
	disableWorker();
}

// Test-only: point the decoder at a specific compiled worker file and reset worker state so the next
// decode spawns fresh. Production resolves the worker next to the bundle (workerPath above).
export function _setImageWorkerPathForTest(newPath: string): void {
	workerPath = newPath;
	workerUnavailable = false;
	workers.length = 0;
	pendingJobs.clear();
	nextJobId = 1;
}

// Test-only: undo _setImageWorkerPathForTest, restoring both the production-default worker path
// (see defaultWorkerPath above) and the disabled pool every other test in the suite expects by
// default. Without this, a test that points the decoder at a real compiled worker would leave the
// pool armed with a path that doesn't exist outside its own outDir, so the next test to decode an
// image anywhere in the suite would spawn (and crash) a worker it never asked for.
export function _resetImageWorkerPathForTest(): void {
	workerPath = defaultWorkerPath;
	workerUnavailable = true;
}

// Test-only: terminate the worker pool so the test process can settle between cases.
export async function _terminateImageWorkerForTest(): Promise<void> {
	const dead = workers.slice();
	workers.length = 0;
	workerUnavailable = false;
	for (const state of dead) {
		state.worker.removeAllListeners();
		await state.worker.terminate();
	}
}

// Test-only: current pool size, so a test can assert the pool grew under a decode burst.
export function _getWorkerCountForTest(): number {
	return workers.length;
}
