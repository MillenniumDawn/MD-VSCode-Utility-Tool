import * as assert from "node:assert";
import * as vscode from "vscode";
import { waitFor } from "../../waitfor";

const expectsActive = process.env.MD_EXPECTS_ACTIVE !== "no";
const extensionId = "MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026";

suite("workspaceContains activation", () => {
	test("activates only when the workspace file matches an activation event", async () => {
		const extension = vscode.extensions.getExtension(extensionId);
		assert.ok(extension, "extension not found");
		if (expectsActive) {
			await waitFor(() => extension.isActive, {
				timeout: 15000,
				message: "the extension did not activate on its own",
			});
		}
		assert.strictEqual(
			extension.isActive,
			expectsActive,
			expectsActive ? "the extension did not activate on its own" : "the extension activated without a matching file",
		);
	});
});
