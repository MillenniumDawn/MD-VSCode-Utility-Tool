import { Host, handOverHost } from "../../util/host";

type Parts<T> = T extends object ? { [K in keyof T]?: Parts<T[K]> } : T;

// Hands the code under test the parts of the editor's API a test exercises, as plain objects.
// Anything left out is undefined, so code that reaches further than the test expected fails there.
export function handOver(parts: Parts<Host>): void {
	handOverHost(parts as Host);
}

// A source module with its module-level state as it is when the extension first loads it. The
// path is relative to this file.
export function fresh<T>(modulePath: string): T {
	const resolved = require.resolve(modulePath);
	delete require.cache[resolved];
	return require(resolved) as T;
}

// No test leaves a host behind for the next one to lean on.
afterEach(() => handOverHost(undefined));
