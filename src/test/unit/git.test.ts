import * as assert from "assert";
import * as fs from "fs";
import { createGitRepository } from "./git";

describe("test Git repositories", () => {
	const cwd = process.cwd();
	let repository: ReturnType<typeof createGitRepository>;

	beforeEach(() => {
		repository = createGitRepository("git-fixture-");
	});

	afterEach(() => {
		repository.dispose();
		assert.strictEqual(process.cwd(), cwd);
		assert.strictEqual(fs.existsSync(repository.directory), false);
	});

	it("runs commands in an isolated repository without changing the current directory", () => {
		assert.strictEqual(process.cwd(), cwd);
		assert.strictEqual(repository.git("branch", "--show-current"), "main");
		assert.strictEqual(fs.realpathSync.native(repository.git("rev-parse", "--show-toplevel")), repository.directory);
	});

	it("preserves command failures after entering the repository", () => {
		repository.enter();
		assert.strictEqual(process.cwd(), repository.directory);
		assert.throws(() => repository.git("rev-parse", "--verify", "--quiet", "refs/heads/missing"),
			(error: NodeJS.ErrnoException & { status?: number }) => error.status !== 0);
	});
});
