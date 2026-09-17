// @ts-nocheck
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
	const extensionDevelopmentPath = path.resolve(__dirname, "../../../../");
	const extensionTestsPath = path.resolve(__dirname, "./suite/index");
	try {
		await runTests({
			// Pinned so the build under test only changes with a commit. The cache step in
			// .github/workflows/test.yml hashes this file, so moving the pin is what fetches a new build.
			version: "1.138.0",
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ["--disable-extensions"],
		});
	} catch (err) {
		console.error("Failed to run integration tests", err);
		process.exit(1);
	}
}

void main();
