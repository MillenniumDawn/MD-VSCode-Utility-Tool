import * as assert from "assert";
import * as vscode from "vscode";
import { error } from "../util/debug";
import { UserError } from "../util/common";
import { Logger } from "../util/logger";

// error() used to reach only the console and telemetry, so the HOI4 Modding channel a user opens
// to diagnose a failed preview showed none of it; and the channel was never disposed (issue #370).
describe("util/logger", function () {
	describe("error()", function () {
		let messages: string[];
		let originalError: (message: string) => void;
		let originalConsoleError: typeof console.error;

		beforeEach(function () {
			messages = [];
			originalError = Logger.error;
			Logger.error = (message: string) => {
				messages.push(message);
			};
			originalConsoleError = console.error;
			console.error = () => undefined;
		});

		afterEach(function () {
			Logger.error = originalError;
			console.error = originalConsoleError;
		});

		it("writes an Error to the channel with its stack", function () {
			error(new Error("parse failed"));
			assert.strictEqual(messages.length, 1);
			assert.ok(messages[0].includes("parse failed"), messages[0]);
			assert.ok(messages[0].includes("logger.test"), messages[0]);
		});

		it("writes a string message to the channel as it is", function () {
			error("Failed to get image gfx/foo.dds");
			assert.deepStrictEqual(messages, ["Failed to get image gfx/foo.dds"]);
		});

		it("writes a UserError to the channel even though it skips telemetry", function () {
			error(new UserError("no mod descriptor"));
			assert.strictEqual(messages.length, 1);
			assert.ok(messages[0].includes("no mod descriptor"), messages[0]);
		});
	});

	describe("dispose", function () {
		it("disposes the channel, and a later log does not create another", function () {
			const window = vscode.window as unknown as { createOutputChannel: unknown };
			const originalCreate = window.createOutputChannel;
			const lines: string[] = [];
			let created = 0;
			let disposed = 0;
			window.createOutputChannel = () => {
				created++;
				return {
					appendLine: (line: string) => {
						lines.push(line);
					},
					dispose: () => {
						disposed++;
					},
				};
			};

			try {
				Logger.initialize().dispose();
				created = 0;
				disposed = 0;

				const registration = Logger.initialize();
				Logger.info("indexed");
				registration.dispose();

				assert.strictEqual(created, 1);
				assert.strictEqual(disposed, 1);
				assert.strictEqual(lines.length, 1);
				assert.ok(lines[0].includes("indexed"), lines[0]);

				Logger.error("after deactivate");
				assert.strictEqual(created, 1);
				assert.strictEqual(lines.length, 1);
			} finally {
				window.createOutputChannel = originalCreate;
				Logger.initialize();
			}
		});
	});
});
