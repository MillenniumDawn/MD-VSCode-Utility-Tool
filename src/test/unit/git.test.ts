import * as assert from "assert";
import * as fs from "fs";
import { createGitRepository } from "./git";

describe("test Git repositories", () => {
	it("runs commands in an isolated repository without changing the current directory", () => {
		const cwd = process.cwd();
		const repository = createGitRepository("git-fixture-");
		try {
			assert.strictEqual(process.cwd(), cwd);
			assert.strictEqual(repository.git("branch", "--show-current"), "main");
			assert.strictEqual(fs.realpathSync.native(repository.git("rev-parse", "--show-toplevel")), repository.directory);
		} finally {
			repository.dispose();
		}
	});

	it("preserves command failures and restores the working directory before cleanup", () => {
		const cwd = process.cwd();
		const repository = createGitRepository("git-fixture-");
		try {
			repository.enter();
			assert.strictEqual(process.cwd(), repository.directory);
			assert.throws(() => repository.git("rev-parse", "--verify", "--quiet", "refs/heads/missing"),
				(error: NodeJS.ErrnoException & { status?: number }) => error.status !== 0);
		} finally {
			repository.dispose();
		}
		assert.strictEqual(process.cwd(), cwd);
		assert.strictEqual(fs.existsSync(repository.directory), false);
	});
});
