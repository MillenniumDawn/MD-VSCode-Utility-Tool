// DDS/TGA -> PNG decode abstraction. On the desktop (node) build it offloads decoding to a single
// long-lived worker_threads worker so a focus tree full of DDS icons doesn't stall the extension
// host. On the web build (or when a worker can't be spawned, or after a worker crash) it falls back
// to a synchronous decode that is byte-for-byte identical to the original inline getImage path.
//
// worker_threads and every other node-only require live strictly inside `if (!IS_WEB_EXT)` blocks
// (mirroring fileloader.ts) so terser dead-code-eliminates them from the web bundle.
import * as path from 'path';
import { PNG } from 'pngjs';
import { DDS } from './dds';
import { ddsToPng, tgaToPng } from './converter';
import { UserError } from '../common';
import { debug, error } from '../debug';

export interface DecodedImage {
    pngBuffer: Buffer;
    width: number;
    height: number;
}

type WorkerInstance = import('worker_threads').Worker;

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
}

// The guaranteed synchronous fallback. Identical to the original inline decode in getImage; the DDS
// path deliberately keeps `buffer.buffer`/`buffer.byteOffset` so a pooled Node Buffer is read from
// the correct offset.
export function decodeImageToPngSync(buffer: Buffer, kind: 'dds' | 'tga'): DecodedImage {
    let png: PNG;
    if (kind === 'dds') {
        png = ddsToPng(DDS.parse(buffer.buffer as ArrayBuffer, buffer.byteOffset));
    } else {
        png = tgaToPng(buffer);
    }

    const pngBuffer = PNG.sync.write(png);
    return { pngBuffer, width: png.width, height: png.height };
}

const pendingJobs = new Map<number, PendingJob>();
let nextJobId = 1;
let worker: WorkerInstance | null = null;
// Once a worker fails to spawn or crashes we never respawn it; every subsequent decode uses the sync
// fallback (see the brief). In-flight jobs at crash time are rejected.
let workerUnavailable = false;
// In the bundle __dirname is dist/, next to extension.js, where the imageWorker entry is emitted.
let workerPath = path.join(__dirname, 'imageWorker.js');

let ensureWorker: (() => WorkerInstance | null) | null = null;

if (!IS_WEB_EXT) {
    ensureWorker = function ensureWorkerImpl(): WorkerInstance | null {
        if (workerUnavailable) {
            return null;
        }
        if (worker) {
            return worker;
        }

        try {
            const { Worker } = require('worker_threads') as typeof import('worker_threads');
            const spawned = new Worker(workerPath);
            spawned.on('message', onWorkerMessage);
            spawned.on('error', onWorkerError);
            spawned.on('exit', onWorkerExit);
            worker = spawned;
            debug('[imagedecoder] spawned image decode worker: ' + workerPath);
            return spawned;
        } catch (e) {
            error(e);
            disableWorker();
            return null;
        }
    };
}

function onWorkerMessage(response: WorkerResponse): void {
    const job = pendingJobs.get(response.id);
    if (!job) {
        return;
    }

    pendingJobs.delete(response.id);
    if (response.error) {
        job.reject(reviveError(response.error));
    } else if (response.png) {
        // Buffer.from(ArrayBuffer) wraps the transferred buffer without copying.
        job.resolve({ pngBuffer: Buffer.from(response.png), width: response.width ?? 0, height: response.height ?? 0 });
    } else {
        job.reject(new Error('image decode worker returned an empty response'));
    }
}

function onWorkerError(e: unknown): void {
    error(e);
    failAllPendingJobs(e instanceof Error ? e : new Error(String(e)));
    disableWorker();
}

function onWorkerExit(code: number): void {
    worker = null;
    if (pendingJobs.size > 0) {
        const reason = new Error('image decode worker exited (code ' + code + ') with jobs in flight');
        error(reason);
        failAllPendingJobs(reason);
    }
    workerUnavailable = true;
}

function disableWorker(): void {
    workerUnavailable = true;
    const dead = worker;
    worker = null;
    if (dead) {
        try {
            dead.removeAllListeners();
            void dead.terminate();
        } catch (e) {
            // The worker is already gone; nothing to clean up.
        }
    }
}

function failAllPendingJobs(reason: Error): void {
    for (const job of pendingJobs.values()) {
        job.reject(reason);
    }
    pendingJobs.clear();
}

function reviveError(info: { message: string; name: string }): Error {
    // Preserve UserError identity so getImage keeps distinguishing user errors from real failures.
    if (info.name === 'UserError') {
        return new UserError(info.message);
    }
    const e = new Error(info.message);
    e.name = info.name;
    return e;
}

function postJob(activeWorker: WorkerInstance, buffer: Buffer, kind: 'dds' | 'tga'): Promise<DecodedImage> {
    return new Promise<DecodedImage>((resolve, reject) => {
        const id = nextJobId++;
        pendingJobs.set(id, { resolve, reject });
        try {
            // Copy into a private ArrayBuffer before transferring: the source Buffer is shared and
            // cached in fileContentCache, so it must never be detached. The copy is the only cost
            // paid on the main thread; the heavy decode and PNG encode run in the worker.
            const payload = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
            activeWorker.postMessage({ id, kind, buffer: payload }, [payload]);
        } catch (e) {
            pendingJobs.delete(id);
            reject(e);
        }
    });
}

export async function decodeImageToPng(buffer: Buffer, kind: 'dds' | 'tga'): Promise<DecodedImage> {
    if (!IS_WEB_EXT) {
        const activeWorker = ensureWorker ? ensureWorker() : null;
        if (activeWorker) {
            return await postJob(activeWorker, buffer, kind);
        }
    }

    return decodeImageToPngSync(buffer, kind);
}

// Test-only: point the decoder at a specific compiled worker file and reset worker state so the next
// decode spawns fresh. Production resolves the worker next to the bundle (workerPath above).
export function _setImageWorkerPathForTest(newPath: string): void {
    workerPath = newPath;
    workerUnavailable = false;
    worker = null;
    pendingJobs.clear();
    nextJobId = 1;
}

// Test-only: terminate the long-lived worker so the test process can settle between cases.
export async function _terminateImageWorkerForTest(): Promise<void> {
    const dead = worker;
    worker = null;
    workerUnavailable = false;
    if (dead) {
        dead.removeAllListeners();
        await dead.terminate();
    }
}
