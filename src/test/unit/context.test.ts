import * as assert from "assert";
import type * as vscode from "vscode";
import { contextContainer, registerContextContainer, setVscodeContext } from "../../context";
import { handOver } from "./host";

describe("context", () => {
	it("holds the extension context from registration until it is disposed", () => {
		const context = { extensionUri: "ext:/" } as unknown as vscode.ExtensionContext;
		const registration = registerContextContainer(context);
		assert.strictEqual(contextContainer.current, context);
		registration.dispose();
		assert.strictEqual(contextContainer.current, null);
	});

	it("sets a context key in the editor and remembers what it set", () => {
		const executed: unknown[][] = [];
		handOver({ commands: { executeCommand: async (...args: unknown[]) => void executed.push(args) } });

		setVscodeContext("mdHoi4PreviewType", "event");
		setVscodeContext("mdHoi4MULoaded", true);
		assert.deepStrictEqual(executed, [
			["setContext", "mdHoi4PreviewType", "event"],
			["setContext", "mdHoi4MULoaded", true],
		]);
		assert.strictEqual(contextContainer.contextValue.mdHoi4PreviewType, "event");
		assert.strictEqual(contextContainer.contextValue.mdHoi4MULoaded, true);
	});
});
