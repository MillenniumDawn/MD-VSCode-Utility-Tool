import * as assert from "assert";
import type * as vscode from "vscode";
import { isSameUri } from "../../../util/vsccommon";

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
