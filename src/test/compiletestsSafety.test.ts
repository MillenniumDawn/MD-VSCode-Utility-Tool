import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// The outDir containment checks behind the purge, in a file of their own so the runner
// behaviour in compiletests.test.ts is not touched: a recursive delete only ever runs on the
// directory a project emits into, so that directory must never resolve outside the root the
// config was read from.
const compileTests = require("../../../scripts/compile-tests");

describe("outDir containment", function () {
	let root: string;

	beforeEach(function () {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "compile-tests-safety-"));
	});

	afterEach(function () {
		fs.rmSync(root, { recursive: true, force: true });
	});

	function writeConfig(outDir: string) {
		fs.writeFileSync(
			path.join(root, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { outDir } }),
		);
	}

	// A directory outside the root the purge must never touch, holding one file to prove it
	// came out of the run untouched.
	function outsideRoot(prefix: string) {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		fs.writeFileSync(path.join(outside, "sentinel.txt"), "keep me");
		return outside;
	}

	describe("outputDir", function () {
		it("resolves a valid nested outDir that already exists", function () {
			writeConfig("out-test/deep");
			fs.mkdirSync(path.join(root, "out-test", "deep"), { recursive: true });

			const outDir = compileTests.outputDir("tsconfig.json", root);

			assert.strictEqual(outDir, path.join(root, "out-test", "deep"));
		});

		it("resolves a valid nested outDir that does not exist yet", function () {
			writeConfig("out-test/missing/deeper");

			const outDir = compileTests.outputDir("tsconfig.json", root);

			assert.strictEqual(
				outDir,
				path.join(root, "out-test", "missing", "deeper"),
			);
		});
	});

	describe("purge", function () {
		it("purges a valid nested outDir, stale files and all, leaving the rest", function () {
			writeConfig("out-test/deep");
			fs.mkdirSync(path.join(root, "out-test", "deep"), { recursive: true });
			fs.writeFileSync(path.join(root, "out-test", "deep", "stale.js"), "");
			fs.writeFileSync(path.join(root, "keep.txt"), "");

			compileTests.purge("tsconfig.json", root);

			assert.ok(!fs.existsSync(path.join(root, "out-test", "deep")));
			assert.ok(fs.existsSync(path.join(root, "keep.txt")));
		});

		it("accepts a valid nested outDir that does not exist yet", function () {
			writeConfig("out-test/missing/deeper");

			assert.doesNotThrow(() => compileTests.purge("tsconfig.json", root));
			assert.ok(!fs.existsSync(path.join(root, "out-test")));
		});

		it('refuses a ".." traversal and leaves the target outside untouched', function () {
			const outside = outsideRoot("compile-tests-escape-");
			try {
				writeConfig(`../${path.basename(outside)}`);

				assert.throws(
					() => compileTests.purge("tsconfig.json", root),
					/strict descendant/,
				);
				assert.ok(fs.existsSync(path.join(outside, "sentinel.txt")));
			} finally {
				fs.rmSync(outside, { recursive: true, force: true });
			}
		});

		it("refuses an absolute outDir outside the root and leaves the target untouched", function () {
			const outside = outsideRoot("compile-tests-absolute-");
			try {
				writeConfig(outside);

				assert.throws(
					() => compileTests.purge("tsconfig.json", root),
					/strict descendant/,
				);
				assert.ok(fs.existsSync(path.join(outside, "sentinel.txt")));
			} finally {
				fs.rmSync(outside, { recursive: true, force: true });
			}
		});

		it("refuses a sibling whose name merely extends the root directory name", function () {
			const sibling = path.join(
				path.dirname(root),
				`${path.basename(root)}-sibling`,
			);
			fs.mkdirSync(sibling);
			try {
				fs.writeFileSync(path.join(sibling, "sentinel.txt"), "keep me");
				writeConfig(`../${path.basename(root)}-sibling`);

				assert.throws(
					() => compileTests.purge("tsconfig.json", root),
					/strict descendant/,
				);
				assert.ok(fs.existsSync(path.join(sibling, "sentinel.txt")));
			} finally {
				fs.rmSync(sibling, { recursive: true, force: true });
			}
		});

		it("refuses a symlink ancestor that escapes the root and leaves the target untouched", function () {
			const outside = outsideRoot("compile-tests-symlink-");
			try {
				const target = path.join(outside, "target");
				fs.mkdirSync(target);
				fs.writeFileSync(path.join(target, "sentinel.txt"), "keep me");
				fs.symlinkSync(target, path.join(root, "link"), "junction");
				writeConfig("link/sub");

				assert.throws(
					() => compileTests.purge("tsconfig.json", root),
					/outside the repository root/,
				);
				assert.ok(fs.existsSync(path.join(target, "sentinel.txt")));
			} finally {
				fs.rmSync(outside, { recursive: true, force: true });
			}
		});

		it("refuses a dangling symlink ancestor before anything is removed", function () {
			const outside = outsideRoot("compile-tests-dangling-");
			try {
				fs.symlinkSync(
					path.join(outside, "vanished"),
					path.join(root, "dangling"),
					"junction",
				);
				writeConfig("dangling/sub");

				assert.throws(
					() => compileTests.purge("tsconfig.json", root),
					/dangling symlink/,
				);
				assert.ok(fs.lstatSync(path.join(root, "dangling")).isSymbolicLink());
			} finally {
				fs.rmSync(outside, { recursive: true, force: true });
			}
		});
	});
});
