import * as path from "node:path";
import { runTests } from "@vscode/test-web";

async function main(): Promise<void> {
	const extensionDevelopmentPath = path.resolve(__dirname, "../../../../");
	const extensionTestsPath = path.resolve(__dirname, "./web/suite/index");
	const folderPath = path.resolve(__dirname, "../../../../src/test/fixtures/browser-smoke");
	try {
		await runTests({
			browserType: "chromium",
			quality: "stable",
			extensionDevelopmentPath,
			extensionTestsPath,
			folderPath,
			testRunnerDataDir: path.resolve(extensionDevelopmentPath, ".vscode-test-web"),
		});
	} catch (err) {
		console.error("Failed to run web extension tests", err);
		process.exit(1);
	}
}

void main();
