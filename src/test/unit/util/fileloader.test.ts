import * as assert from "assert";
import * as path from "path";
import type * as vscode from "vscode";
import { fresh, handOver } from "../host";

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
