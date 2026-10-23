import "./setup";
import * as assert from "assert";
import { RenderTask, RenderedCard, pushGroupTasks, taskRunner } from "../../../webviewsrc/util/batchrender";

describe("webview/util/batchrender", () => {
	describe("taskRunner", () => {
		it("runs every task in order and then calls done, straight through without frames", () => {
			const ran: string[] = [];
			taskRunner()([() => ran.push("a"), () => ran.push("b")], () => ran.push("done"));
			assert.deepStrictEqual(ran, ["a", "b", "done"]);
		});

		describe("across frames", () => {
			let frames: (() => void)[] = [];
			let now = 0;
			const realNow = Date.now;

			beforeEach(() => {
				frames = [];
				now = 0;
				(globalThis as any).requestAnimationFrame = (fn: () => void) => frames.push(fn);
				Date.now = () => now;
			});

			afterEach(() => {
				delete (globalThis as any).requestAnimationFrame;
				Date.now = realNow;
			});

			// Each task uses up a whole frame's budget, so every frame runs exactly one.
			function slowTasks(log: string[], name: string, count: number): RenderTask[] {
				return Array.from({ length: count }, (_, i) => () => {
					log.push(`${name}${i}`);
					now += 10;
				});
			}

			it("stops an earlier run once a newer one starts", () => {
				const run = taskRunner();
				const log: string[] = [];
				run(slowTasks(log, "old", 3), () => log.push("old done"));
				run(slowTasks(log, "new", 2), () => log.push("new done"));
				while (frames.length > 0) {
					frames.shift()!();
				}
				assert.deepStrictEqual(log, ["old0", "new0", "new1", "new done"]);
			});

			it("keeps two runners apart", () => {
				const log: string[] = [];
				taskRunner()(slowTasks(log, "a", 2), () => log.push("a done"));
				taskRunner()(slowTasks(log, "b", 2), () => log.push("b done"));
				while (frames.length > 0) {
					frames.shift()!();
				}
				assert.deepStrictEqual(log, ["a0", "b0", "a1", "a done", "b1", "b done"]);
			});
		});
	});

	describe("pushGroupTasks", () => {
		it("opens the group first, then fills its flow a batch at a time, recording each card", () => {
			const container = document.createElement("div");
			const tasks: RenderTask[] = [];
			const rendered: RenderedCard<number>[] = [];
			pushGroupTasks(
				tasks,
				() => {
					const flow = document.createElement("div");
					container.appendChild(flow);
					return flow;
				},
				[1, 2, 3, 4, 5],
				2,
				(card) => {
					const element = document.createElement("div");
					element.textContent = String(card);
					return element;
				},
				rendered,
			);

			assert.strictEqual(tasks.length, 4);
			tasks.forEach((task) => task());
			assert.strictEqual(container.firstElementChild?.textContent, "12345");
			assert.deepStrictEqual(rendered.map((r) => r.card), [1, 2, 3, 4, 5]);
			assert.strictEqual(rendered[2]?.element.textContent, "3");
		});
	});
});
