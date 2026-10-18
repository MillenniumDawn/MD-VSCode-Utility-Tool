// Benchmark/test-only adapter. Snapshot buffers have already been copied by imagedecoder.
// It bounds posted messages, not retained snapshots. It is deliberately not used in production.
function observeDispatch(Worker, { bounded, record = () => undefined, now = Date.now, workerEntry, starts }) {
	return class ObservedWorker extends Worker {
		constructor(entry, options) {
			super(workerEntry ?? entry, workerEntry ? { ...options, workerData: { entry, starts } } : options);
			this.waiting = [];
			this.activeId = undefined;
			this.on("error", () => { this.waiting.length = 0; });
			this.on("exit", () => { this.waiting.length = 0; });
			this.on("message", (response) => {
				record({ type: "response", id: response.id, at: now() });
				if (bounded && response.id === this.activeId) {
					this.activeId = undefined;
					this.dispatchNext();
				}
			});
		}

		postMessage(request, transfer) {
			record({ type: "enqueue", id: request.id, at: now() });
			if (bounded) {
				this.waiting.push({ request, transfer });
				this.dispatchNext(true);
			} else {
				record({ type: "dispatch", id: request.id, at: now() });
				super.postMessage(request, transfer);
			}
		}

		dispatchNext(propagateFailure = false) {
			if (this.activeId !== undefined) {
				return;
			}
			const next = this.waiting.shift();
			if (next) {
				this.activeId = next.request.id;
				record({ type: "dispatch", id: next.request.id, at: now() });
				try {
					super.postMessage(next.request, next.transfer);
				} catch (e) {
					if (propagateFailure) {
						this.activeId = undefined;
						throw e;
					}
					// A deferred post has no submitting stack to throw through; fail only that job.
					queueMicrotask(() => this.emit("message", { id: next.request.id,
						error: { name: e instanceof Error ? e.name : "Error", message: e instanceof Error ? e.message : String(e) } }));
				}
			}
		}

		terminate() {
			this.waiting.length = 0;
			return super.terminate();
		}
	};
}

module.exports = { observeDispatch };
