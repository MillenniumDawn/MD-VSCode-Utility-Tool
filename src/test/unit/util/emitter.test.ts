import * as assert from "assert";
import { mock } from "node:test";
import { createEmitter } from "../../../util/emitter";
import { Logger } from "../../../util/logger";
import { handOver } from "../host";

describe("util/emitter", () => {
	afterEach(() => {
		Logger.dispose();
		mock.restoreAll();
	});

	it("tells every listener, in the order they started listening, until they stop", () => {
		const emitter = createEmitter<string>();
		const heard: string[] = [];
		const first = emitter.event((value) => heard.push(`first:${value}`));
		emitter.event((value) => heard.push(`second:${value}`));

		emitter.fire("a");
		first.dispose();
		first.dispose();
		emitter.fire("b");
		assert.deepStrictEqual(heard, ["first:a", "second:a", "second:b"]);
	});

	it("can be listened to through its event alone", () => {
		const emitter = createEmitter<number>();
		const { event } = emitter;
		const heard: number[] = [];
		event((value) => heard.push(value));
		emitter.fire(1);
		assert.deepStrictEqual(heard, [1]);
	});

	it("reports a listener that throws and still tells the rest", () => {
		const lines: string[] = [];
		handOver({
			window: { createOutputChannel: () => ({ appendLine: (line: string) => lines.push(line), dispose: () => undefined }) },
		});
		mock.method(console, "error", () => undefined);
		Logger.initialize();

		const emitter = createEmitter<string>();
		const heard: string[] = [];
		emitter.event(() => {
			throw new Error("listener failed");
		});
		emitter.event((value) => heard.push(value));

		emitter.fire("a");
		assert.deepStrictEqual(heard, ["a"]);
		assert.match(lines[0], /\[ERROR\] Error: listener failed/);
	});
});
