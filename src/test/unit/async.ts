// A promise settled from outside, for tests that decide when a piece of work finishes.
export interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

export function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Lets every promise callback already queued run, however long the chain behind it.
export function settle(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
