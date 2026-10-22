import * as assert from "assert";
import type * as vscode from "vscode";
import { refreshFeatureFlags } from "../../../util/featureflags";
import { html, loadingShellHtml } from "../../../util/html";
import { handOver } from "../host";

function policyOf(page: string): string[] {
	const policy = /Content-Security-Policy" content="([^"]*)"/.exec(page)?.[1] ?? "";
	return policy.split(";").map((directive) => directive.trim());
}

describe("util/html", () => {
	const webview = { asWebviewUri: (uri: unknown) => uri, cspSource: "stub-csp" } as unknown as vscode.Webview;

	beforeEach(() => {
		handOver({ workspace: { getConfiguration: () => ({}) } });
		refreshFeatureFlags();
	});

	// A form in a preview is the one thing mod markup could still use to send a reader off the page.
	it("lets no form submit from a preview page", () => {
		assert.ok(policyOf(html(webview, "", [])).includes("form-action 'none'"));
	});

	it("lets no form submit from the loading shell", () => {
		assert.ok(policyOf(loadingShellHtml("Loading")).includes("form-action 'none'"));
	});
});
