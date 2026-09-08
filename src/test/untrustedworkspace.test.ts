import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// These four settings decide where every file the extension reads comes from. The extension is
// supported in untrusted workspaces and activates on workspaceContains:, so merely opening a
// hostile repo activates it -- and without this declaration that repo's own .vscode/settings.json
// could silently repoint all of those reads. Issue #221.
const restricted = [
	"mdHoi4Utilities.installPath",
	"mdHoi4Utilities.modFile",
	"mdHoi4Utilities.inlayWindowGfxRoots",
	"mdHoi4Utilities.technologyGfxRoots",
];

describe("package.json untrusted workspace capabilities", () => {
	const packageJson = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "..", "..", "..", "package.json"),
			"utf8",
		),
	);

	it("restricts the settings that redirect where files are read from", () => {
		const untrusted = packageJson.capabilities?.untrustedWorkspaces;
		assert.ok(untrusted, "expected capabilities.untrustedWorkspaces");
		assert.deepStrictEqual(
			[...(untrusted.restrictedConfigurations as string[])].sort(),
			[...restricted].sort(),
		);
	});

	// A rename that misses the list above would leave the setting unrestricted and say nothing.
	it("names settings the extension actually contributes", () => {
		const contributed = packageJson.contributes.configuration.flatMap(
			(c: any) => Object.keys(c.properties as Record<string, unknown>),
		);

		for (const setting of restricted) {
			assert.ok(
				contributed.includes(setting),
				`${setting} is restricted but not contributed`,
			);
		}
	});
});
