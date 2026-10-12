import { error } from "./debug";

// The `event` and `fire` of vscode.EventEmitter with nothing of the host, for events that never
// leave the extension's own code.
export interface Emitter<T> {
	/** Starts listening; dispose what comes back to stop. */
	event(listener: (value: T) => unknown): { dispose(): void };
	fire(value: T): void;
}

export function createEmitter<T>(): Emitter<T> {
	const listeners = new Set<(value: T) => unknown>();
	return {
		event(listener) {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		// As in the editor's emitter, a listener that throws is reported and the rest still hear
		// the event.
		fire(value) {
			for (const listener of [...listeners]) {
				try {
					listener(value);
				} catch (e) {
					error(e);
				}
			}
		},
	};
}
