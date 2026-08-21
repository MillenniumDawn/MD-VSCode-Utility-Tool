import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { CancelledError } from "../util/common";
import { walkFilesWithMtime, MAX_WALK_DEPTH } from "../util/nativewalk";

// The walk runs on node's own fs, so it is tested against a real directory rather than a fake one.
// A fake would elide exactly the assumptions worth checking: that a Dirent carries no inode, that a
// Windows junction reports isSymbolicLink(), that realpath canonicalises, and that mtime.getTime()
// is the same number vscode's FileStat.mtime reports.

const isWindows = process.platform === "win32";

async function writeFile(root: string, relativePath: string, content = "x") {
	const full = path.join(root, relativePath);
	await fs.mkdir(path.dirname(full), { recursive: true });
	await fs.writeFile(full, content);
	return full;
}

/**
 * Directory links are junctions on Windows, which need no elevation; file links do need Developer
 * Mode, so that test skips on a machine without it rather than going red.
 */
async function tryLink(
	target: string,
	link: string,
	type: "junction" | "file",
): Promise<boolean> {
	try {
		await fs.symlink(target, link, isWindows ? type : type === "junction" ? "dir" : "file");
		return true;
	} catch {
		return false;
	}
}

function sorted(paths: string[]): string[] {
	return [...paths].sort();
}

describe("util/nativewalk walkFilesWithMtime", function () {
	let root: string;

	beforeEach(async function () {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "hoi4walk-"));
	});

	afterEach(async function () {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("returns names and mtimes from a single pass", async function () {
		const file = await writeFile(root, "sub/deep/a.txt");
		const when = new Date(Date.UTC(2021, 4, 6, 7, 8, 9));
		await fs.utimes(file, when, when);

		const entries = await walkFilesWithMtime(root, { recursively: true });

		assert.deepStrictEqual(
			sorted(entries.map((e) => e.relativePath)),
			["sub/deep/a.txt"],
		);
		// getTime(), not mtimeMs: a sub-millisecond fraction here would never compare equal to the
		// whole-millisecond mtime the same file reports through vscode.workspace.fs.
		assert.strictEqual(entries[0]!.mtime, when.getTime());
		assert.strictEqual(entries[0]!.fsPath, file);
	});

	it("uses forward slashes in relative paths, like the vscode walk it replaces", async function () {
		await writeFile(root, "a/b/c.txt");

		const entries = await walkFilesWithMtime(root, { recursively: true });

		assert.deepStrictEqual(
			entries.map((e) => e.relativePath),
			["a/b/c.txt"],
		);
	});

	it("lists only the top level when not asked to recurse", async function () {
		await writeFile(root, "top.txt");
		await writeFile(root, "sub/nested.txt");

		const entries = await walkFilesWithMtime(root);

		assert.deepStrictEqual(sorted(entries.map((e) => e.relativePath)), ["top.txt"]);
	});

	it("throws for a root that is not on disk, so the caller can fall back", async function () {
		await assert.rejects(() => walkFilesWithMtime(path.join(root, "nope")));
	});

	it("stops at the depth cap and says so once", async function () {
		const deep = Array.from({ length: 6 }, (_, i) => `d${i}`).join("/");
		await writeFile(root, `${deep}/deep.txt`);
		await writeFile(root, "shallow.txt");
		const warnings: string[] = [];

		const entries = await walkFilesWithMtime(root, {
			recursively: true,
			maxDepth: 3,
			onWarning: (m) => warnings.push(m),
		});

		assert.deepStrictEqual(sorted(entries.map((e) => e.relativePath)), ["shallow.txt"]);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0]!.includes("depth 3"), warnings[0]);
	});

	it("defaults the depth cap to MAX_WALK_DEPTH", async function () {
		assert.strictEqual(MAX_WALK_DEPTH, 32);
		const deep = Array.from({ length: 8 }, (_, i) => `d${i}`).join("/");
		await writeFile(root, `${deep}/deep.txt`);

		const entries = await walkFilesWithMtime(root, { recursively: true });

		// Eight levels is nothing against the default cap, so the file is still found.
		assert.deepStrictEqual(entries.map((e) => e.relativePath), [`${deep}/deep.txt`]);
	});

	it("terminates on a directory link that points back at an ancestor", async function () {
		await writeFile(root, "sub/a.txt");
		if (!(await tryLink(root, path.join(root, "sub", "loop"), "junction"))) {
			this.skip();
		}
		const warnings: string[] = [];

		const entries = await walkFilesWithMtime(root, {
			recursively: true,
			onWarning: (m) => warnings.push(m),
		});

		// Without the guard this never returns; with it, the one real file appears exactly once.
		assert.deepStrictEqual(sorted(entries.map((e) => e.relativePath)), ["sub/a.txt"]);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0]!.includes("already walked"), warnings[0]);
	});

	it("walks a directory reached through a link", async function () {
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hoi4walk-out-"));
		try {
			await writeFile(outside, "linked.txt");
			if (!(await tryLink(outside, path.join(root, "viaLink"), "junction"))) {
				this.skip();
			}

			const entries = await walkFilesWithMtime(root, { recursively: true });

			// The vscode.workspace.fs walk drops this: its FileType is Directory|SymbolicLink, which
			// matches neither of the two values it compares against.
			assert.deepStrictEqual(
				sorted(entries.map((e) => e.relativePath)),
				["viaLink/linked.txt"],
			);
		} finally {
			await fs.rm(outside, { recursive: true, force: true });
		}
	});

	it("includes a file reached through a link", async function () {
		const target = await writeFile(root, "real.txt");
		if (!(await tryLink(target, path.join(root, "link.txt"), "file"))) {
			this.skip(); // file symlinks need Developer Mode on Windows
		}

		const entries = await walkFilesWithMtime(root, { recursively: true });

		assert.deepStrictEqual(
			sorted(entries.map((e) => e.relativePath)),
			["link.txt", "real.txt"],
		);
	});

	it("skips a broken link instead of failing the walk", async function () {
		await writeFile(root, "real.txt");
		if (!(await tryLink(path.join(root, "gone.txt"), path.join(root, "dangling.txt"), "file"))) {
			this.skip();
		}

		const entries = await walkFilesWithMtime(root, { recursively: true });

		assert.deepStrictEqual(sorted(entries.map((e) => e.relativePath)), ["real.txt"]);
	});

	it("rejects with CancelledError rather than returning what it had", async function () {
		await writeFile(root, "a.txt");

		await assert.rejects(
			() => walkFilesWithMtime(root, { token: { isCancellationRequested: true } }),
			CancelledError,
		);
	});

	it("rejects when the token flips part-way through", async function () {
		await writeFile(root, "sub/a.txt");
		await writeFile(root, "sub/b.txt");
		let reads = 0;
		const token = {
			// False for the very first check, true from then on, so the walk starts and is cut off.
			get isCancellationRequested() {
				return ++reads > 1;
			},
		};

		await assert.rejects(
			() => walkFilesWithMtime(root, { recursively: true, token }),
			CancelledError,
		);
	});
});
