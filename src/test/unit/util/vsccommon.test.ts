import * as assert from "assert";
import * as path from "path";
import type * as vscode from "vscode";
import { isDirectory, isFile, isSameUri } from "../../../util/vsccommon";
import { handOver } from "../host";

function uri(fsPath: string, scheme = "file", fragment = ""): vscode.Uri {
	return { scheme, fsPath, toString: () => `${scheme}:${fsPath}#${fragment}` } as vscode.Uri;
}

describe("util/vsccommon URI identity", () => {
	const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
	afterEach(() => Object.defineProperty(process, "platform", platform));

	for (const os of ["linux", "win32"]) {
		it(`compares case-distinct absolute folders on ${os}`, () => {
			Object.defineProperty(process, "platform", { ...platform, value: os });
			assert.strictEqual(isSameUri(uri("/mods/Parent/x.txt"), uri("/mods/parent/x.txt")), os === "win32");
		});
	}

	it("keeps a backslash in a Linux file name apart from a folder separator", function () {
		// Windows path.resolve turns the backslash into a separator before the comparison.
		if (path.sep === "\\") {
			this.skip();
		}
		Object.defineProperty(process, "platform", { ...platform, value: "linux" });
		assert.strictEqual(isSameUri(uri("/mods/a\\b.txt"), uri("/mods/a/b.txt")), false);
	});

	it("normalizes file path segments and ignores file URI fragments", () => {
		assert.strictEqual(isSameUri(uri("/mods/parent/common/../x.txt"), uri("/mods/parent/x.txt", "file", ":opened")), true);
	});

	it("keeps different absolute paths distinct", () => {
		assert.strictEqual(isSameUri(uri("/mods/parent/x.txt"), uri("/mods/parent/y.txt")), false);
	});

	it("compares non-file URIs by their complete spelling", () => {
		Object.defineProperty(process, "platform", { ...platform, value: "win32" });
		assert.strictEqual(isSameUri(uri("/Parent/x.txt", "hoi4installpath"), uri("/parent/x.txt", "hoi4installpath")), false);
		assert.strictEqual(isSameUri(uri("/parent/x.txt", "hoi4installpath"), uri("/parent/x.txt", "hoi4installpath", "other")), false);
		assert.strictEqual(isSameUri(uri("/parent/x.txt", "hoi4installpath"), uri("/parent/x.txt", "hoi4installpath")), true);
		assert.strictEqual(isSameUri(uri("/parent/x.txt"), uri("/parent/x.txt", "hoi4installpath")), false);
	});
});

describe("util/vsccommon file type checks", () => {
	// FileType is a bitfield: a symlink carries its target's bit together with SymbolicLink.
	const File = 1;
	const Directory = 2;
	const SymbolicLink = 64;
	const Unknown = 0;

	// An editor whose stat reports the given type, or rejects as it does for a dangling link.
	function handOverStat(type: number | Error): void {
		handOver({
			FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
			workspace: {
				fs: {
					stat: async (): Promise<vscode.FileStat> =>
						type instanceof Error
							? Promise.reject(type)
							: { type: type as vscode.FileType, ctime: 0, mtime: 0, size: 0 },
				},
			},
		});
	}

	it("accepts a linked mod descriptor and a linked install folder", async () => {
		handOverStat(File | SymbolicLink);
		assert.strictEqual(await isFile(uri("/mods/descriptor.mod")), true);
		handOverStat(Directory | SymbolicLink);
		assert.strictEqual(await isDirectory(uri("/hoi4")), true);
	});

	it("answers false when stat rejects, as for a dangling link", async () => {
		handOverStat(new Error("ENOENT: dangling link"));
		assert.strictEqual(await isFile(uri("/mods/gone.mod")), false);
		assert.strictEqual(await isDirectory(uri("/mods/gone")), false);
	});

	it("answers false for a bare symlink and for an unknown type", async () => {
		for (const type of [SymbolicLink, Unknown]) {
			handOverStat(type);
			assert.strictEqual(await isFile(uri("/mods/link")), false);
			assert.strictEqual(await isDirectory(uri("/mods/link")), false);
		}
	});

	it("answers ordinary types on their own side only", async () => {
		handOverStat(File);
		assert.strictEqual(await isFile(uri("/mods/descriptor.mod")), true);
		assert.strictEqual(await isDirectory(uri("/mods/descriptor.mod")), false);
		handOverStat(Directory);
		assert.strictEqual(await isDirectory(uri("/mods")), true);
		assert.strictEqual(await isFile(uri("/mods")), false);
	});
});
