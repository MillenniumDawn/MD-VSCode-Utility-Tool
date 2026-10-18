import * as assert from "assert";
import { EventEmitter } from "events";
import * as path from "path";
import { fresh, handOver } from "../../host";
import { UserError } from "../../../../util/common";

type Decoder = typeof import("../../../../util/image/imagedecoder");
const threads = require("worker_threads") as typeof import("worker_threads");
const { observeDispatch } = require(path.resolve(__dirname, "../../../../../../scripts/image-dispatch-experiment.js"));

interface Request { id: number; kind: string; buffer: ArrayBuffer }
interface Timer { fire: () => void; cleared: boolean; ms: number; unref: () => Timer }

class ControlledWorker extends EventEmitter {
	static instances: ControlledWorker[] = [];
	static failId = 0;
	stderr = new EventEmitter();
	requests: Request[] = [];
	terminated = false;
	constructor() {
		super();
		ControlledWorker.instances.push(this);
	}
	postMessage(request: Request, transfer: ArrayBuffer[]): void {
		if (request.id === ControlledWorker.failId) { throw new Error("postMessage failed"); }
		this.requests.push(structuredClone(request, { transfer }));
	}
	finish(error?: { name: string; message: string }): number {
		const request = this.requests.shift();
		assert.ok(request, "a worker must have a dispatched request");
		const first = new Uint8Array(request.buffer)[0];
		this.emit("message", error ? { id: request.id, error }
			: { id: request.id, png: Uint8Array.of(first).buffer, width: first, height: 1 });
		return request.id;
	}
	terminate(): Promise<number> {
		this.terminated = true;
		this.requests.length = 0;
		return Promise.resolve(0);
	}
}

for (const bounded of [false, true]) {
	describe(`image dispatch contracts (${bounded ? "snapshot-preserving experiment" : "production"})`, () => {
		let decoder: Decoder;
		let timers: Timer[];
		let restore: () => void;
		let pool: number;
		beforeEach(() => {
			pool = 1;
			timers = [];
			ControlledWorker.instances = [];
			ControlledWorker.failId = 0;
			handOver({ workspace: { getConfiguration: () => ({ imageDecodeWorkers: pool }) },
				window: { createOutputChannel: () => ({ appendLine: () => undefined }) } });
			const originalWorker = threads.Worker;
			const originalSet = global.setTimeout;
			const originalClear = global.clearTimeout;
			const originalError = console.error;
			threads.Worker = observeDispatch(ControlledWorker, { bounded });
			console.error = () => undefined;
			global.setTimeout = ((callback: () => void, ms: number) => {
				const timer: Timer = { fire: callback, ms, cleared: false, unref: () => timer };
				timers.push(timer);
				return timer;
			}) as unknown as typeof setTimeout;
			global.clearTimeout = ((timer: Timer) => { timer.cleared = true; }) as unknown as typeof clearTimeout;
			decoder = fresh<Decoder>("../../util/image/imagedecoder");
			decoder._setImageWorkerPathForTest("controlled-worker");
			restore = () => {
				threads.Worker = originalWorker;
				global.setTimeout = originalSet;
				global.clearTimeout = originalClear;
				console.error = originalError;
			};
		});
		afterEach(async () => {
			try {
				await decoder._terminateImageWorkerForTest();
				decoder._resetImageWorkerPathForTest();
			} finally { restore(); }
			assert.ok(ControlledWorker.instances.every((w) => w.terminated));
			assert.ok(timers.every((t) => t.cleared), "every submitted job timer must be cleared");
		});

		it("snapshots saturated inputs before callers can mutate them", async () => {
			const first = decoder.decodeImageToPng(Buffer.from([1]), "tga");
			const input = Buffer.from([2]);
			const second = decoder.decodeImageToPng(input, "tga");
			input[0] = 9;
			const worker = ControlledWorker.instances[0];
			assert.strictEqual(worker.requests.length, bounded ? 1 : 2);
			worker.finish();
			worker.finish();
			assert.deepStrictEqual((await Promise.all([first, second])).map((r) => r.width), [1, 2]);
			assert.strictEqual(input[0], 9);
		});

		it("preserves per-worker FIFO, routing, saturation and cross-worker completion", async () => {
			pool = 2;
			const order: number[] = [];
			const pending = Array.from({ length: 6 }, (_, i) => decoder.decodeImageToPng(Buffer.from([i + 1]), "tga")
				.then((r) => { order.push(r.width); return r.width; }));
			const [a, b] = ControlledWorker.instances;
			assert.strictEqual(ControlledWorker.instances.length, 2);
			assert.strictEqual(a.requests.length, bounded ? 1 : 3);
			b.finish(); await Promise.resolve(); await Promise.resolve();
			a.finish(); await Promise.resolve(); await Promise.resolve();
			b.finish(); await Promise.resolve(); await Promise.resolve();
			a.finish(); await Promise.resolve(); await Promise.resolve();
			a.finish(); b.finish();
			assert.deepStrictEqual(await Promise.all(pending), [1, 2, 3, 4, 5, 6]);
			assert.deepStrictEqual(order, [2, 1, 4, 3, 5, 6]);
		});

		it("continues queued work after a UserError without synchronous fallback", async () => {
			const pending = Promise.allSettled([1, 2, 3].map((n) => decoder.decodeImageToPng(Buffer.from([n]), "tga")));
			const worker = ControlledWorker.instances[0];
			worker.finish({ name: "UserError", message: "bad input" });
			worker.finish(); worker.finish();
			const results = await pending;
			assert.strictEqual(results[0].status, "rejected");
			if (results[0].status === "rejected") { assert.ok(results[0].reason instanceof UserError); }
			assert.deepStrictEqual(results.slice(1).map((r) => r.status === "fulfilled" && r.value.width), [2, 3]);
			assert.strictEqual(decoder._getWorkerCountForTest(), 1);
		});

		it("starts every timeout on submission and evicts queued collateral work on timeout", async () => {
			decoder._setImageJobTimeoutForTest(123);
			const pending = Promise.allSettled([1, 2, 3].map((n) => decoder.decodeImageToPng(Buffer.from([n]), "tga")));
			assert.deepStrictEqual(timers.map((t) => t.ms), [123, 123, 123]);
			timers[0].fire();
			for (const result of await pending) {
				assert.strictEqual(result.status, "rejected");
				if (result.status === "rejected") { assert.strictEqual(result.reason.name, "ImageDecodeTimeoutError"); }
			}
			assert.strictEqual(ControlledWorker.instances[0].terminated, true);
			assert.strictEqual(decoder._getWorkerCountForTest(), 0);
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), false);
			const recovery = decoder.decodeImageToPng(Buffer.from([4]), "tga");
			ControlledWorker.instances[1].finish();
			assert.strictEqual((await recovery).width, 4);
		});

		it("settles active and queued work through the existing synchronous fallback on disposal", async () => {
			const input = Buffer.alloc(22);
			input[2] = 2; input.writeUInt16LE(1, 12); input.writeUInt16LE(1, 14); input[16] = 32;
			const pending = Promise.all([1, 2, 3].map(() => decoder.decodeImageToPng(input, "tga")));
			decoder.disposeImageDecodeWorkers();
			assert.ok((await pending).every((r) => r.width === 1));
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), true);
			assert.strictEqual(decoder._getWorkerCountForTest(), 0);
		});

		it("settles queued startup failures with the same fallback and no delayed posts", async () => {
			const input = Buffer.alloc(22);
			input[2] = 2; input.writeUInt16LE(1, 12); input.writeUInt16LE(1, 14); input[16] = 32;
			const pending = Promise.all([1, 2, 3].map(() => decoder.decodeImageToPng(input, "tga")));
			const worker = ControlledWorker.instances[0];
			worker.emit("error", new Error("startup failed"));
			worker.emit("exit", 1);
			assert.ok((await pending).every((r) => r.width === 1));
			// A worker that exits on its own needs no terminate() in the production teardown.
			worker.terminated = true;
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), true);
		});

		it("preserves mutable-source behavior in the existing startup fallback", async () => {
			const input = Buffer.alloc(26);
			input[2] = 2; input.writeUInt16LE(1, 12); input.writeUInt16LE(1, 14); input[16] = 32;
			const pending = decoder.decodeImageToPng(input, "tga");
			input.writeUInt16LE(2, 12);
			const worker = ControlledWorker.instances[0];
			worker.emit("error", new Error("startup failed"));
			worker.emit("exit", 1);
			worker.terminated = true;
			assert.strictEqual((await pending).width, 2);
		});

		it("settles queued work when a worker exits without emitting an error", async () => {
			const input = Buffer.alloc(22);
			input[2] = 2; input.writeUInt16LE(1, 12); input.writeUInt16LE(1, 14); input[16] = 32;
			const pending = Promise.all([1, 2, 3].map(() => decoder.decodeImageToPng(input, "tga")));
			const worker = ControlledWorker.instances[0];
			worker.emit("exit", 1);
			worker.terminated = true;
			assert.ok((await pending).every((r) => r.width === 1));
			assert.strictEqual(decoder._getWorkerCountForTest(), 0);
		});

		it("fails only an initial post exception without disabling the pool or leaving a timer", async () => {
			ControlledWorker.failId = 1;
			const input = Buffer.alloc(22);
			input[2] = 2; input.writeUInt16LE(1, 12); input.writeUInt16LE(1, 14); input[16] = 32;
			assert.strictEqual((await decoder.decodeImageToPng(input, "tga")).width, 1);
			assert.strictEqual(decoder._getWorkerCountForTest(), 1);
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), false);
			assert.deepStrictEqual(timers, []);
			const recovery = decoder.decodeImageToPng(Buffer.from([4]), "tga");
			ControlledWorker.instances[0].finish();
			assert.strictEqual((await recovery).width, 4);
		});

		it("fails only a queued post exception and continues later FIFO work", async () => {
			ControlledWorker.failId = 2;
			const input = Buffer.alloc(22);
			input[2] = 2; input.writeUInt16LE(1, 12); input.writeUInt16LE(1, 14); input[16] = 32;
			const pending = Promise.all([
				decoder.decodeImageToPng(Buffer.from([1]), "tga"),
				decoder.decodeImageToPng(input, "tga"),
				decoder.decodeImageToPng(Buffer.from([3]), "tga"),
			]);
			const worker = ControlledWorker.instances[0];
			worker.finish();
			await Promise.resolve(); await Promise.resolve();
			worker.finish();
			assert.deepStrictEqual((await pending).map((r) => r.width), [1, 1, 3]);
			assert.strictEqual(decoder._getWorkerCountForTest(), 1);
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), false);
		});
	});
}
