import * as assert from "assert";

const actionsLog = require("../../../../../../scripts/lib/actions-log");

describe("scripts/lib/actions-log", () => {
	it("escapes workflow command data and properties into single-line annotations", () => {
		const stderr = process.stderr.write;
		const annotations: string[] = [];
		process.stderr.write = ((chunk: string) => {
			annotations.push(chunk);
			return true;
		}) as typeof stderr;

		try {
			actionsLog.warn("warning");
			actionsLog.notice("notice");
			actionsLog.warn("uncovered", { file: "src/file.ts", line: 3 });

			const hostile = "%25\r\n::error file=attacker,line=9::injected";
			actionsLog.warn(hostile);
			actionsLog.notice(hostile);
			actionsLog.warn(hostile, {
				file: "src/file:%2C\n::error,attacker",
				line: "4,%25\r\n::error:attacker",
			});
		} finally {
			process.stderr.write = stderr;
		}

		assert.deepStrictEqual(annotations, [
			"::warning::warning\n",
			"::notice::notice\n",
			"::warning file=src/file.ts,line=3::uncovered\n",
			"::warning::%2525%0D%0A::error file=attacker,line=9::injected\n",
			"::notice::%2525%0D%0A::error file=attacker,line=9::injected\n",
			"::warning file=src/file%3A%252C%0A%3A%3Aerror%2Cattacker,line=4%2C%2525%0D%0A%3A%3Aerror%3Aattacker::%2525%0D%0A::error file=attacker,line=9::injected\n",
		]);
		assert.ok(annotations.every((annotation) => annotation.split("\n").length === 2));
	});
});
