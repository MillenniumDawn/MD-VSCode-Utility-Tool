import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import * as yaml from "js-yaml";
import type { Configuration, RuleSetRule } from "webpack";

const root = path.resolve(__dirname, "../../../..");
const configure: (env: object, argv: { mode: string }) => Configuration[] = require("../../../../webpack.config.js");
const { nativeTscCommand }: { nativeTscCommand: () => { command: string; args: string[] } } = require("../../../../scripts/native-tsc.js");
const typecheck = "node scripts/native-tsc.js --noEmit -p tsconfig.json";

interface Step {
	run?: string;
	if?: string;
	"continue-on-error"?: boolean;
}

interface Job {
	steps: Step[];
	needs?: string[];
}

function jobs(file: string): Record<string, Job> {
	return (yaml.load(fs.readFileSync(path.join(root, ".github/workflows", file), "utf8")) as {
		jobs: Record<string, Job>;
	}).jobs;
}

describe("webpack type-checking", function () {
	for (const mode of ["development", "production"]) {
		it(`only transpiles TypeScript in every ${mode} bundle`, function () {
			const configs = configure({}, { mode });
			assert.strictEqual(configs.length, 4);
			for (const config of configs) {
				const rule = config.module?.rules?.find((rule): rule is RuleSetRule => typeof rule === "object" &&
					rule !== null && rule.test instanceof RegExp && rule.test.test("entry.ts"));
				assert.ok(rule);
				assert.deepStrictEqual(rule.use, [{ loader: "ts-loader", options: { transpileOnly: true } }]);
			}
		});
	}

	for (const [file, job] of [["test.yml", "test"], ["release.yml", "verify"]]) {
		it(`requires the production type-check once in ${file}`, function () {
			const steps = jobs(file)[job].steps;
			const checks = steps.filter((step) => step.run?.includes("tsc"));
			assert.strictEqual(checks.length, 1);
			assert.strictEqual(checks[0].run, typecheck);
			assert.strictEqual(checks[0].if, undefined);
			assert.strictEqual(checks[0]["continue-on-error"], undefined);
			if (file === "test.yml") {
				assert.ok(steps.indexOf(checks[0]) < steps.findIndex((step) => step.run === "npm run package"));
			} else {
				const release = jobs(file);
				for (const target of ["pre-release-marketplace", "pre-release-open-vsx", "release-marketplace", "release-open-vsx"]) {
					assert.ok(release[target].needs?.includes("verify"), target);
				}
			}
		});
	}

	it("fails tsc on the production checks the test projects do not enforce", function () {
		this.timeout(15_000);
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), "md-webpack-typecheck-"));
		const config = path.join(folder, "tsconfig.json");
		const fixture = path.join(folder, "fixture.ts");
		try {
			fs.writeFileSync(config, JSON.stringify({
				extends: path.join(root, "tsconfig.json"),
				compilerOptions: { rootDir: folder },
				include: ["fixture.ts"],
			}));
			fs.writeFileSync(fixture, [
				"export const first: number = ([] as number[])[0];",
				"const unused = 1;",
				"export function identity(value: number, ignored: number) { return value; }",
				"class Base { method() {} }",
				"export class Derived extends Base { method() {} }",
			].join("\n"));
			const { command, args } = nativeTscCommand();
			const result = spawnSync(command, [...args, "--noEmit", "-p", config], { encoding: "utf8" });
			assert.ifError(result.error);
			// The native compiler exits 1 on diagnostics where the JavaScript tsc exited 2; the
			// failure itself is still exact, and the diagnostic codes below are what it must say.
			assert.strictEqual(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stdout, /TS2322/);
			assert.match(result.stdout, /TS6133: 'unused'/);
			assert.match(result.stdout, /TS6133: 'ignored'/);
			assert.match(result.stdout, /TS4114/);
		} finally {
			fs.unlinkSync(fixture);
			fs.unlinkSync(config);
			fs.rmdirSync(folder);
		}
	});
});
