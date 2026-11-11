import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const { restoreDependencyPaths }: { restoreDependencyPaths: (cwd: string, directories: string[]) => string[] } =
	require("../../../../../scripts/package-extension");
const wrapper = path.resolve(__dirname, "../../../../../scripts/package-extension.js");
const uuid = "12345678-1234-1234-1234-123456789abc";
const AdmZip = require("adm-zip") as new (file: string) => {
	getEntries(): { entryName: string; getData(): Buffer }[];
};

describe("scripts/package-extension dependency paths", () => {
	it("restores the known UUID root and its production dependency paths", () => {
		const cwd = path.join(os.tmpdir(), `pi-worktree-${uuid}-s0-0`);
		const redacted = cwd.replace(uuid, "***");
		const dependency = path.join("node_modules", "@scope", "production");
		assert.deepStrictEqual(restoreDependencyPaths(cwd, [redacted, path.join(redacted, dependency)]), [
			cwd, path.join(cwd, dependency),
		]);
	});

	it("preserves unredacted paths, external dependencies, and prefix siblings", () => {
		const cwd = path.join(os.tmpdir(), `pi-worktree-${uuid}`);
		const redacted = cwd.replace(uuid, "***");
		const directories = [cwd, path.join(cwd, "node_modules", "production"),
			path.join(os.tmpdir(), "external"), `${redacted}-other`, path.join(`${redacted}-other`, "node_modules", "production")];
		assert.deepStrictEqual(restoreDependencyPaths(cwd, directories), directories);
	});

	it("handles more than one UUID in the checkout path", () => {
		const cwd = path.join(os.tmpdir(), uuid, `pi-worktree-${uuid}-s0-0`);
		const redacted = cwd.replaceAll(uuid, "***");
		assert.deepStrictEqual(restoreDependencyPaths(cwd, [redacted]), [cwd]);
	});
});

describe("scripts/package-extension VSIX", function () {
	this.timeout(30_000);
	let root: string;
	let files: string[];
	let directories: string[];

	function write(file: string, content: string): void {
		const directory = path.dirname(file);
		if (directory !== "." && !directories.includes(directory)) {
			fs.mkdirSync(path.join(root, directory));
			directories.push(directory);
		}
		fs.writeFileSync(path.join(root, file), content);
		files.push(file);
	}

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), `md-package-${uuid}-`));
		files = [];
		directories = [];
		write("package.json", JSON.stringify({
			name: "packaging-fixture", publisher: "fixture", version: "1.0.0",
			description: "Packaging regression fixture", engines: { vscode: "^1.74.0" },
			repository: "https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool",
			license: "MIT", main: "./dist/extension.js", browser: "./dist/web-extension.js", activationEvents: ["onLanguage:plaintext"],
			scripts: { "vscode:prepublish": "node prepublish.js" },
			dependencies: { production: "1.0.0" }, devDependencies: { development: "1.0.0" },
		}));
		write("README.md", "# Packaging fixture\n");
		write("LICENSE.txt", "MIT\n");
		write(".vscodeignore", "extension.vsix\nprepublish.js\n");
		write("dist/extension.js", "exports.activate = () => {};\n");
		write("dist/web-extension.js", "exports.activate = () => {};\n");
		write("prepublish.js", 'require("fs").writeFileSync("dist/prepublished.js", "exports.built = true;\\n");\n');
		fs.mkdirSync(path.join(root, "node_modules"));
		directories.push("node_modules");
		write("node_modules/production/package.json", JSON.stringify({
			name: "production", version: "1.0.0", main: "index.js", dependencies: { transitive: "1.0.0" },
		}));
		write("node_modules/production/index.js", "module.exports = 1;\n");
		write("node_modules/transitive/package.json", JSON.stringify({ name: "transitive", version: "1.0.0", main: "index.js" }));
		write("node_modules/transitive/index.js", "module.exports = 2;\n");
		write("node_modules/development/package.json", JSON.stringify({ name: "development", version: "1.0.0", main: "index.js" }));
		write("node_modules/development/index.js", "module.exports = 3;\n");
		files.push("dist/prepublished.js", "extension.vsix");
	});

	afterEach(() => {
		for (const file of files.reverse()) {
			const target = path.join(root, file);
			if (fs.existsSync(target)) {
				fs.unlinkSync(target);
			}
		}
		for (const directory of directories.reverse()) {
			fs.rmdirSync(path.join(root, directory));
		}
		fs.rmdirSync(root);
	});

	for (const preRelease of [false, true]) {
		it(`packages both entrypoints and production dependencies from a UUID path${preRelease ? " as a pre-release" : ""}`, () => {
			const result = spawnSync(process.execPath, [wrapper, "--out", "extension.vsix", ...(preRelease ? ["--pre-release"] : [])], {
				cwd: root, encoding: "utf8", timeout: 25_000,
			});
			assert.ifError(result.error);
			assert.strictEqual(result.status, 0, result.stdout + result.stderr);
			const entries = new AdmZip(path.join(root, "extension.vsix")).getEntries();
			const names = entries.map(entry => entry.entryName);
			for (const file of ["dist/extension.js", "dist/web-extension.js", "dist/prepublished.js",
				"node_modules/production/index.js", "node_modules/transitive/index.js"]) {
				assert.ok(names.includes(`extension/${file}`), file);
			}
			assert.ok(!names.some(name => name.includes("node_modules/development/")));
			const manifest = entries.find(entry => entry.entryName === "extension.vsixmanifest")!.getData().toString();
			assert.strictEqual(manifest.includes('Id="Microsoft.VisualStudio.Code.PreRelease" Value="true"'), preRelease);
		});
	}

	it("still refuses to package a secret", () => {
		write("credentials.txt", "npm_" + "a".repeat(36));
		const result = spawnSync(process.execPath, [wrapper, "--out", "extension.vsix"], {
			cwd: root, encoding: "utf8", timeout: 25_000,
		});
		assert.ifError(result.error);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stdout + result.stderr, /found npm access token/);
		assert.ok(!fs.existsSync(path.join(root, "extension.vsix")));
	});
});
