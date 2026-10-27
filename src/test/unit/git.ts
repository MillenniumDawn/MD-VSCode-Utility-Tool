import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function createGitRepository(prefix: string) {
	const cwd = process.cwd();
	const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	const git = (...args: string[]): string => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "main");
	git("config", "user.email", "a@b.c");
	git("config", "user.name", "Tester");
	// Keep line-ending warnings out of the test output on Windows.
	git("config", "core.autocrlf", "false");
	return {
		directory,
		git,
		enter: () => process.chdir(directory),
		dispose: () => {
			process.chdir(cwd);
			fs.rmSync(directory, { recursive: true, force: true });
		},
	};
}
