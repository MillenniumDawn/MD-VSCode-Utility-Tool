import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type * as vscode from "vscode";
import { fresh, handOver } from "../host";
import { clearDlcZipCache } from "../../../util/fileloader";
import { listIndexFiles } from "../../../util/indexListing";
import { clearInstallPathCache } from "../../../util/installpath";
import { openZipIndex } from "../../../util/nativezip";
import { clearParentModCache } from "../../../util/parentmods";

// A copy of fileloader per test: openedDocumentUriFor keeps its map of open documents in module
// state and rebuilds it at most every 500 ms, so one test's documents would otherwise go on
// answering for the next one's.
function freshFileloader(): typeof import("../../../util/fileloader") {
	return fresh<typeof import("../../../util/fileloader")>(
		"../../util/fileloader",
	);
}

function uri(fsPath: string, fragment = ""): vscode.Uri {
	return {
		scheme: "file",
		path: fsPath,
		fsPath,
		fragment,
		with: (change: { path?: string; fragment?: string }): vscode.Uri =>
			uri(change.path ?? fsPath, change.fragment ?? fragment),
		toString: () =>
			`file://${fsPath}${fragment === "" ? "" : "#" + fragment}`,
	} as vscode.Uri;
}

// The editor holds each path as an open document reading "OPENED"; every disk read of anything
// else lands in diskReads and answers "DISK".
function handOverFiles(openPaths: string[], diskReads: string[]): void {
	handOver({
		workspace: {
			textDocuments: openPaths.map((openPath) => ({
				uri: uri(openPath),
				getText: () => "OPENED",
			})),
			fs: {
				readFile: (target: vscode.Uri) => {
					diskReads.push(target.fsPath);
					return Promise.resolve(Buffer.from("DISK"));
				},
			},
		},
	});
}

describe("util/fileloader resolved read open-buffer substitution", () => {
	const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
	afterEach(() => Object.defineProperty(process, "platform", platform));

	it("reads the open buffer for the exact file the editor holds", async () => {
		const diskReads: string[] = [];
		handOverFiles(["/mods/events/x.txt"], diskReads);

		const [buffer, resolved] = await freshFileloader()
			.readFileFromModOrHOI4(
				"events/x.txt",
				undefined,
				uri("/mods/events/x.txt"),
			);

		assert.strictEqual(buffer.toString(), "OPENED");
		assert.strictEqual(resolved.fragment, ":opened");
		assert.deepStrictEqual(diskReads, []);
	});

	it("reads the disk file when only a case-distinct file is open on Linux", () => {
		Object.defineProperty(process, "platform", { ...platform, value: "linux" });
		const diskReads: string[] = [];
		handOverFiles(["/mods/events/x.txt"], diskReads);

		return freshFileloader()
			.readFileFromModOrHOI4("Events/X.txt", undefined, uri("/mods/Events/X.txt"))
			.then(([buffer, resolved]) => {
				assert.strictEqual(buffer.toString(), "DISK");
				assert.strictEqual(resolved.fragment, "");
				assert.deepStrictEqual(diskReads, ["/mods/Events/X.txt"]);
			});
	});

	it("reads the open buffer for a case-distinct spelling of the same file on Windows", () => {
		Object.defineProperty(process, "platform", { ...platform, value: "win32" });
		const diskReads: string[] = [];
		handOverFiles(["/mods/Events/X.txt"], diskReads);

		return freshFileloader()
			.readFileFromModOrHOI4("events/x.txt", undefined, uri("/mods/events/x.txt"))
			.then(([buffer, resolved]) => {
				assert.strictEqual(buffer.toString(), "OPENED");
				assert.strictEqual(resolved.fragment, ":opened");
				assert.deepStrictEqual(diskReads, []);
			});
	});

	it("reads the disk file when a Linux file name holds a backslash", function () {
		// A Windows path.resolve turns the backslash into a separator before the key is built.
		if (path.sep === "\\") {
			this.skip();
		}
		Object.defineProperty(process, "platform", { ...platform, value: "linux" });
		const diskReads: string[] = [];
		handOverFiles(["/mods/a\\b.txt"], diskReads);

		return freshFileloader()
			.readFileFromModOrHOI4("a/b.txt", undefined, uri("/mods/a/b.txt"))
			.then(([buffer, resolved]) => {
				assert.strictEqual(buffer.toString(), "DISK");
				assert.strictEqual(resolved.fragment, "");
				assert.deepStrictEqual(diskReads, ["/mods/a/b.txt"]);
			});
	});
});

// A real archive on disk, reached through the DLC path the extension itself uses: the install
// setting points at a fixture whose dlc/dlc001/dlc001.zip is written by adm-zip and read back by
// the production zip reader. `interface/` exists only implicitly -- no folder entries at all --
// while `events/` is spelled out as a trailing-slash entry, which is the distinction issue #717
// turns on. `interface_extra/` shares the `interface` prefix and must never list with it.
describe("util/fileloader DLC zip directory listings", function () {
	const zipMtime = 4242;
	let tempRoot = "";
	let zipPath = "";
	let fileloader: typeof import("../../../util/fileloader");

	function makeUri(scheme: string, uriPath: string, fragment = ""): vscode.Uri {
		return {
			scheme,
			path: uriPath,
			fsPath: uriPath,
			fragment,
			with: (change: {
				scheme?: string;
				path?: string;
				fragment?: string;
			}): vscode.Uri =>
				makeUri(
					change.scheme ?? scheme,
					change.path ?? uriPath,
					change.fragment ?? fragment,
				),
			toString: () =>
				`${scheme}://${uriPath}${fragment === "" ? "" : "#" + fragment}`,
		} as vscode.Uri;
	}

	function parseUri(value: string): vscode.Uri {
		const hash = value.indexOf("#");
		const fragment = hash >= 0 ? value.slice(hash + 1) : "";
		const bare = hash >= 0 ? value.slice(0, hash) : value;
		const colon = bare.indexOf(":");
		return makeUri(
			bare.slice(0, colon),
			bare.slice(colon + 1).replace(/^\/\//, ""),
			fragment,
		);
	}

	// The install tree only the hoi4installpath: scheme sees: the folder under test, the dlc roots
	// holding the archive, and the install copy of the one file the archive also holds. Anything
	// else -- including files that exist only in the archive -- does not stat.
	function stat(target: vscode.Uri): Promise<vscode.FileStat> {
		const key = target.path;
		if (key === "/interface" || key === "/dlc" || key === "/dlc/dlc001") {
			return Promise.resolve({ type: 2, mtime: 1, ctime: 0, size: 0 });
		}
		if (key === "/interface/shared.txt") {
			return Promise.resolve({ type: 1, mtime: 1, ctime: 0, size: 0 });
		}
		if (key === "/dlc/dlc001/dlc001.zip") {
			return Promise.resolve({
				type: 1,
				mtime: zipMtime,
				ctime: 0,
				size: 0,
			});
		}
		return Promise.reject(new Error("ENOENT: " + key));
	}

	function readDirectory(
		target: vscode.Uri,
	): Promise<[string, vscode.FileType][]> {
		switch (target.path) {
			case "/interface":
				return Promise.resolve([["shared.txt", 1]]);
			case "/dlc":
				return Promise.resolve([["dlc001", 2]]);
			case "/dlc/dlc001":
				return Promise.resolve([["dlc001.zip", 1]]);
			default:
				return Promise.reject(new Error("ENOENT: " + target.path));
		}
	}

	beforeEach(async function () {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "md-dlc-zip-"));
		zipPath = path.join(tempRoot, "dlc", "dlc001", "dlc001.zip");
		await fs.mkdir(path.dirname(zipPath), { recursive: true });
		await fs.mkdir(path.join(tempRoot, "interface"), { recursive: true });
		await fs.writeFile(
			path.join(tempRoot, "interface", "shared.txt"),
			"install copy",
		);

		const AdmZip = require("adm-zip");
		const zip = new AdmZip();
		zip.addFile("interface/shared.txt", Buffer.from("zip copy"));
		zip.addFile("interface/zip_only.gfx", Buffer.from("zip only"));
		zip.addFile("interface/nested/deep.gfx", Buffer.from("deep"));
		zip.addFile("interface_extra/leak.gfx", Buffer.from("leak"));
		zip.addFile("events/", Buffer.alloc(0)); // the explicit trailing-slash folder entry
		zip.addFile("events/zip_event.txt", Buffer.from("event"));
		zip.addFile("events/nested/sub.txt", Buffer.from("sub"));
		zip.writeZip(zipPath);

		handOver({
			Uri: {
				file: (fsPath: string) => makeUri("file", fsPath),
				parse: (value: string) => parseUri(value),
				joinPath: (base: vscode.Uri, ...parts: string[]) =>
					makeUri(base.scheme, path.posix.join(base.path, ...parts)),
			},
			FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
			workspace: {
				textDocuments: [],
				getConfiguration: () => ({
					modFile: "",
					installPath: tempRoot,
					loadDlcContents: true,
				}),
				fs: { stat, readDirectory },
			},
		});
		clearInstallPathCache();
		clearParentModCache();
		await clearDlcZipCache(); // the caches above are shared module state; the fixture path changes per test
		fileloader = freshFileloader();
	});

	afterEach(async function () {
		await clearDlcZipCache();
		clearInstallPathCache();
		clearParentModCache();
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("reads events/ as an explicit folder entry and interface/ as only implied by its files", async function () {
		const names = (await openZipIndex(zipPath)).entries.map(
			(entry) => entry.name,
		);
		assert.ok(
			names.includes("events/"),
			"the fixture must spell events/ out as an entry",
		);
		assert.ok(
			!names.includes("interface/"),
			"the fixture must leave interface/ implied by its files",
		);
	});

	it("lists a folder the archive stores only as a trailing-slash entry", async function () {
		assert.deepStrictEqual(await fileloader.listFilesFromModOrHOI4("events"), [
			"zip_event.txt",
		]);
	});

	it("lists a folder the archive only implies through its files", async function () {
		assert.deepStrictEqual(
			await fileloader.listFilesFromModOrHOI4("interface"),
			["shared.txt", "zip_only.gfx"],
		);
	});

	it("honors recursive listings with nested relative names, without leaking a prefix sibling", async function () {
		// Sorted: the order of files inside an archive is the archive's own, while presence and
		// paths are the contract.
		assert.deepStrictEqual(
			(
				await fileloader.listFilesFromModOrHOI4("interface", {
					recursively: true,
				})
			).sort(),
			["nested/deep.gfx", "shared.txt", "zip_only.gfx"],
		);
		assert.deepStrictEqual(
			(
				await fileloader.listFilesFromModOrHOI4("events", {
					recursively: true,
				})
			).sort(),
			["nested/sub.txt", "zip_event.txt"],
		);
		assert.deepStrictEqual(
			await fileloader.listFilesFromModOrHOI4("interface_extra"),
			["leak.gfx"],
		);
	});

	it("hands the entry listing resolvable zip URIs and the archive's mtime", async function () {
		const entries = await fileloader.listFileEntriesFromModOrHOI4(
			"interface",
			{ recursively: true },
		);

		const deep = entries.find(
			(entry) => entry.relativePath === "nested/deep.gfx",
		);
		assert.ok(deep, "the nested file must be listed");
		assert.strictEqual(deep.uri.scheme, "hoi4installpath");
		assert.strictEqual(deep.uri.fragment, "interface/nested/deep.gfx");
		assert.strictEqual(deep.mtime, zipMtime);

		const shared = entries.find((entry) => entry.relativePath === "shared.txt");
		// The install folder is visited before the archive, so its copy of the shared file wins.
		assert.strictEqual(shared?.uri.scheme, "file");

		const resolved = await fileloader.getFilePathFromModOrHOI4(
			"interface/nested/deep.gfx",
		);
		assert.ok(resolved);
		assert.strictEqual(resolved.toString(), deep.uri.toString());
	});

	it("reads listed entries using archive casing rather than the requested directory casing", async function () {
		for (const recursively of [false, true]) {
			const entries = await fileloader.listFileEntriesFromModOrHOI4("INTERFACE", { recursively });
			assert.strictEqual(entries.length, recursively ? 3 : 2);
			for (const entry of entries) {
				assert.strictEqual(entry.uri.fragment, `interface/${entry.relativePath}`);
				const [buffer] = await fileloader.readFileFromModOrHOI4(
					`INTERFACE/${entry.relativePath}`, undefined, entry.uri,
				);
				assert.strictEqual(buffer.toString(), {
					"shared.txt": "zip copy", "zip_only.gfx": "zip only", "nested/deep.gfx": "deep",
				}[entry.relativePath]);
			}
		}
	});

	it("dates and resolves every archive file through the index listing path", async function () {
		const listing = await listIndexFiles({
			roots: ["interface", "events"],
			options: { recursively: true },
		});

		assert.deepStrictEqual([...listing.filePaths].sort(), [
			"events/nested/sub.txt",
			"events/zip_event.txt",
			"interface/nested/deep.gfx",
			"interface/shared.txt",
			"interface/zip_only.gfx",
		]);
		// The install folder is still the source of the file both hold.
		assert.strictEqual(listing.uris.get("interface/shared.txt")?.scheme, "file");
		assert.strictEqual(
			listing.mtimes.get("interface/nested/deep.gfx"),
			zipMtime,
		);
		assert.strictEqual(listing.mtimes.get("events/zip_event.txt"), zipMtime);
		assert.strictEqual(
			listing.uris.get("events/nested/sub.txt")?.fragment,
			"events/nested/sub.txt",
		);
		assert.strictEqual(
			listing.filePaths.some((filePath) => filePath.includes("leak")),
			false,
		);
	});
});
