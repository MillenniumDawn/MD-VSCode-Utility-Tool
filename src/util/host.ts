import type * as vscode from "vscode";

// The VS Code API, for every module but the entry point. Nothing else imports `vscode` at run
// time: the extension hands the API over as it activates, and a test hands over plain objects
// with just the parts it exercises. So every module loads without a host, and nothing may reach
// for the API while it is still loading.
export type Host = typeof vscode;

let current: Host | undefined;

export function handOverHost(value: Host | undefined): void {
	current = value;
}

export function host(): Host {
	if (current === undefined) {
		throw new Error("The VS Code API was used before the extension handed it over.");
	}
	return current;
}
