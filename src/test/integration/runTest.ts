import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

// Pinned so the build under test only changes with a commit. The cache step in
// .github/workflows/test.yml hashes this file, so moving the pin is what fetches a new build.
const version = "1.138.0";
const launchArgs = ["--disable-extensions"];
const fixtures = [
	{ file: "common/military_industrial_organization/organizations/sov_mio.txt", expectsActive: "yes" },
	{ file: "interface/sov_gui.gui", expectsActive: "yes" },
	{ file: "scratch/sov_notes.md", expectsActive: "no" },
];

async function main(): Promise<void> {
	const extensionDevelopmentPath = path.resolve(__dirname, "../../../../");
	const extensionTestsPath = path.resolve(__dirname, "./suite/index");
	const activationTestsPath = path.resolve(__dirname, "./suite/activation");
	try {
		await runTests({
			version,
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs,
		});

		for (const fixture of fixtures) {
			const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "md-utilities-activation-"));
			const filePath = path.join(workspacePath, fixture.file);
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, "");
			try {
				await runTests({
					version,
					extensionDevelopmentPath,
					extensionTestsPath: activationTestsPath,
					extensionTestsEnv: { MD_EXPECTS_ACTIVE: fixture.expectsActive },
					launchArgs: [workspacePath, ...launchArgs],
				});
			} finally {
				fs.unlinkSync(filePath);
				let folder = path.dirname(filePath);
				while (folder !== workspacePath) {
					fs.rmdirSync(folder);
					folder = path.dirname(folder);
				}
				fs.rmdirSync(workspacePath);
			}
		}
	} catch (err) {
		console.error("Failed to run integration tests", err);
		process.exit(1);
	}
}

void main();
