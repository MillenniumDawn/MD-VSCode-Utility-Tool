import { Host, handOverHost } from "../../util/host";

type Parts<T> = T extends object ? { [K in keyof T]?: Parts<T[K]> } : T;

// Hands the code under test the parts of the editor's API a test exercises, as plain objects.
// Anything left out is undefined, so code that reaches further than the test expected fails there.
export function handOver(parts: Parts<Host>): void {
	handOverHost(parts as Host);
}

// A copy of a source module for one test alone, with its module-level state as it is when the
// extension first loads it. The copy the rest of the process shares is put back, so nothing loaded
// later picks up this one. The path is relative to this file.
export function fresh<T>(modulePath: string): T {
	const resolved = require.resolve(modulePath);
	const shared = require.cache[resolved];
	delete require.cache[resolved];
	try {
		return require(resolved) as T;
	} finally {
		if (shared) {
			require.cache[resolved] = shared;
		} else {
			delete require.cache[resolved];
		}
	}
}

// No test leaves a host behind for the next one to lean on.
afterEach(() => handOverHost(undefined));
