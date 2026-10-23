import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { PreviewFiles, previewFiles } from "../../previewdef/definition";

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf8"));

describe("package.json activationEvents", () => {
	for (const [type, files] of Object.entries(previewFiles) as [string, PreviewFiles][]) {
		it(`activates a workspace containing ${type} files in their game folder`, () => {
			const pattern = files.folder
				? files.folder.map((segment) => segment === "*" ? `*${files.extension}` : segment).join("/")
				: `interface/**/*${files.extension}`;
			assert.ok(
				manifest.activationEvents.includes(`workspaceContains:${pattern}`),
				`the ${type} preview has no activation event for ${pattern}`,
			);
		});
	}
});
