import * as assert from "assert";
import { mock } from "node:test";
import { UserError } from "../../../util/common";
import { error } from "../../../util/debug";
import * as loggerModule from "../../../util/logger";
import { describeParseFailure, Logger } from "../../../util/logger";
import { fresh, handOver } from "../host";

interface Channel {
	name: string;
	lines: string[];
	disposed: boolean;
}

// An editor whose output channels keep what is written to them.
function channels(): Channel[] {
	const opened: Channel[] = [];
	handOver({
		window: {
			createOutputChannel: (name: string) => {
				const channel: Channel = { name, lines: [], disposed: false };
				opened.push(channel);
				return {
					appendLine: (line: string) => channel.lines.push(line),
					dispose: () => {
						channel.disposed = true;
					},
				};
			},
		},
	});
	return opened;
}

describe("util/logger describeParseFailure", () => {
	it("logs stack for an Error that has a stack", () => {
		const error = new Error("boom");
		assert.ok(error.stack);
		assert.strictEqual(describeParseFailure(error), error.stack);
	});

	for (const stack of [undefined, ""]) {
		it(`falls back to message when an Error has ${stack === undefined ? "no" : "an empty"} stack`, () => {
			const error = new Error("no-stack");
			error.stack = stack;
			assert.strictEqual(describeParseFailure(error), "no-stack");
		});
	}

	const thrownValues: [string, unknown, string][] = [
		["a thrown string", "plain old string", "plain old string"],
		["thrown 42", 42, "42"],
		["thrown null", null, "null"],
		["thrown undefined", undefined, "undefined"],
		["thrown 0", 0, "0"],
		["a thrown object", { toString: () => "custom-obj" }, "custom-obj"],
		["a thrown Symbol", Symbol("sym"), "Symbol(sym)"],
	];
	for (const [title, thrown, expected] of thrownValues) {
		it(`logs String(e) for ${title}`, () => {
			assert.strictEqual(describeParseFailure(thrown), expected);
		});
	}

	it("falls back to Object.prototype.toString when String(e) throws", () => {
		assert.strictEqual(describeParseFailure({
			toString() {
				throw new Error("inner");
			},
		}), "[object Object]");
	});
});

describe("util/logger", () => {
	beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 2, 3, 4, 5) }));

	afterEach(() => {
		Logger.dispose();
		mock.restoreAll();
		mock.timers.reset();
	});

	it("opens its channel on the first line, and stamps every line with the time and its level", () => {
		const opened = channels();
		const { Logger: first } = fresh<typeof loggerModule>("../../util/logger");
		assert.deepStrictEqual(opened, []);

		first.debug("a");
		first.info("b");
		first.warn("c");
		first.error("d");
		assert.deepStrictEqual(opened, [
			{
				name: "HOI4 Modding",
				lines: ["DEBUG] a", "INFO] b", "WARN] c", "ERROR] d"].map((line) => `[2026-01-02T03:04:05.000Z] [${line}`),
				disposed: false,
			},
		]);
		first.dispose();
	});

	it("closes its channel when disposed, and opens none for a line that comes after", () => {
		const opened = channels();
		const subscription = Logger.initialize();
		Logger.info("before");
		subscription.dispose();
		Logger.info("after");
		assert.deepStrictEqual(opened.map((channel) => [channel.lines.length, channel.disposed]), [[1, true]]);

		Logger.initialize();
		Logger.info("activated again");
		assert.deepStrictEqual(opened.map((channel) => channel.lines.length), [1, 1]);
	});

	describe("error() from util/debug", () => {
		const boom = new Error("boom");
		const reports: [string, unknown, RegExp][] = [
			["a message as it is", "disk full", /\[ERROR\] disk full$/],
			["an Error with its stack", boom, /\[ERROR\] Error: boom\n\s+at /],
			["a UserError", new UserError("bad file"), /\[ERROR\] (User)?Error: bad file\n\s+at /],
			["a value that is not an error", { code: 5 }, /\[ERROR\] Error: Non-error value thrown: \{"code":5\}/],
		];

		for (const [title, value, line] of reports) {
			it(`writes ${title} to the channel and to the console`, () => {
				const opened = channels();
				const printed = mock.method(console, "error", () => undefined);
				Logger.initialize();
				error(value);
				assert.match(opened[0].lines[0], line);
				assert.deepStrictEqual(printed.mock.calls.map((call) => call.arguments), [[value]]);
			});
		}
	});
});
