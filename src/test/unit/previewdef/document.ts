import * as assert from "assert";
import type * as vscode from "vscode";
import { refreshFeatureFlags } from "../../../util/featureflags";
import { handOver } from "../host";

// A document as a preview's canPreview meets it. Given no text, it fails the test when it is read.
export function document(path: string, text?: string): vscode.TextDocument {
	return {
		uri: { path, toString: () => `file://${path}` },
		getText: () => text ?? assert.fail(`${path} was read`),
	} as unknown as vscode.TextDocument;
}

// An editor with the given settings, and the feature flags read from them.
export function settings(values: Record<string, unknown>): void {
	handOver({ workspace: { getConfiguration: () => values } });
	refreshFeatureFlags();
}
