import * as assert from "assert";

const publishExtension = require("../../../../../scripts/publish-extension");

for (const [registry, tokenVariable, expectedArgs] of [
	["marketplace", "VSCE_PAT", ["--no-install", "@vscode/vsce", "publish", "--packagePath", "ext.vsix", "--skip-duplicate"]],
	["open-vsx", "OVSX_PAT", ["--no-install", "ovsx", "publish", "ext.vsix", "--skip-duplicate"]],
] as const) {
	describe(`scripts/publish-extension ${registry} spawn boundary`, () => {
		it("passes the selected token only through the child environment", () => {
			const token = "test-fake-publish-token";
			const previousToken = process.env[tokenVariable];
			process.env[tokenVariable] = "test-fake-stale-token";
			try {
				const before = { ...process.env };
				let calls = 0;
				const result = publishExtension.publishOnce(
					{ registry, vsix: "ext.vsix", pat: token, preRelease: false },
					(file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
						calls++;
						assert.strictEqual(file, "npx");
						assert.deepStrictEqual(args, [...expectedArgs]);
						assert.strictEqual(args.some((arg) => arg.includes(token)), false);
						assert.deepStrictEqual(options.env, { ...before, [tokenVariable]: token });
						return { status: 0, stdout: "", stderr: "" };
					},
				);
				assert.strictEqual(calls, 1);
				assert.strictEqual(result.ok, true);
				assert.deepStrictEqual({ ...process.env }, before);
			} finally {
				if (previousToken === undefined) {
					delete process.env[tokenVariable];
				} else {
					process.env[tokenVariable] = previousToken;
				}
			}
		});
	});
}
