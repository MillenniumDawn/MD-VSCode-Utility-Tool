import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const { git, tagExists } = require(path.join(__dirname, "../../../../../../scripts/lib/git")) as {
	git: (args: string[]) => string;
	tagExists: (tag: string) => boolean;
};

describe("scripts/lib/git", () => {
	const originalCwd = process.cwd();
	let repository: string;

	beforeEach(() => {
		repository = fs.mkdtempSync(path.join(os.tmpdir(), "scripts-git-"));
		execFileSync("git", ["init", "--quiet"], { cwd: repository });
		process.chdir(repository);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		fs.rmSync(repository, { recursive: true, force: true });
	});

	it("runs git from the current directory and trims its output", () => {
		assert.strictEqual(git(["rev-parse", "--show-toplevel"]), repository);
	});

	it("reports whether a tag exists and treats a missing tag as false", () => {
		const tree = execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
			encoding: "utf8",
			input: "",
		}).trim();
		execFileSync("git", ["update-ref", "refs/tags/present", tree]);

		assert.strictEqual(tagExists("present"), true);
		assert.strictEqual(tagExists("absent"), false);
	});

	it("preserves git errors from ordinary commands", () => {
		assert.throws(
			() => git(["not-a-git-command"]),
			(error: NodeJS.ErrnoException & { status?: number; stderr?: Buffer }) => {
				return error.status !== 0 && /not-a-git-command/.test(error.stderr?.toString() ?? "");
			},
		);
	});
});
