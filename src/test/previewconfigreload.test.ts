import * as assert from "assert";
import * as vscode from "vscode";
import { PreviewBase } from "../previewdef/previewbase";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
import { focusTreePreviewDef } from "../previewdef/focustree";
import { eventPreviewDef } from "../previewdef/event";
import { ideaPreviewDef } from "../previewdef/idea";
import { decisionPreviewDef } from "../previewdef/decision";
import { characterPreviewDef } from "../previewdef/character";
import { technologyPreviewDef } from "../previewdef/technology";
import { mioPreviewDef } from "../previewdef/mio";
import { guiPreviewDef } from "../previewdef/gui";
import { gfxPreviewDef } from "../previewdef/gfx";

// Five previews each carried their own copy of this listener and four had none, so changing
// inlayWindowGfxRoots did nothing until the file was edited. The copies also called reload()
// without forcing the loader session, and a setting change does not move the document's hash --
// so the loader answered from its cache and the page repainted what it already had. Issue #203.
describe("previewdef configuration reload", () => {
	function panelStub(): any {
		return {
			webview: {
				html: "",
				cspSource: "",
				asWebviewUri: (u: unknown) => u,
				postMessage: () => Promise.resolve(true),
				onDidReceiveMessage: () => ({ dispose: () => undefined }),
			},
			visible: true,
			onDidChangeViewState: () => ({ dispose: () => undefined }),
			onDidDispose: () => ({ dispose: () => undefined }),
		};
	}

	let fire: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
	let subscriptions: number;
	let disposals: number;

	function stub(): void {
		fire = undefined;
		subscriptions = 0;
		disposals = 0;
		stubVscode({
			onDidChangeConfiguration: (handler: any) => {
				subscriptions++;
				fire = handler;
				return {
					dispose: () => {
						disposals++;
					},
				};
			},
		});
	}

	function changed(...keys: string[]): vscode.ConfigurationChangeEvent {
		return {
			affectsConfiguration: (section: string) =>
				keys.some((key) => section === `mdHoi4Utilities.${key}`),
		} as vscode.ConfigurationChangeEvent;
	}

	class Watching extends PreviewBase {
		public reloads: boolean[] = [];

		protected get reloadOnConfigurationChange(): readonly string[] {
			return ["gfxIndex"];
		}

		protected reload(dependencyChanged = false): void {
			this.reloads.push(dependencyChanged);
		}

		protected getContent(): Promise<string> {
			return Promise.resolve("");
		}
	}

	class Indifferent extends PreviewBase {
		protected getContent(): Promise<string> {
			return Promise.resolve("");
		}
	}

	afterEach(() => {
		restoreVscodeStubs();
	});

	it("reloads when a declared setting changes", () => {
		stub();
		const preview = new Watching(vscode.Uri.file("/tmp/a.txt"), panelStub());

		fire!(changed("gfxIndex"));

		assert.deepStrictEqual(preview.reloads, [true]);
	});

	it("ignores a setting it did not declare", () => {
		stub();
		const preview = new Watching(vscode.Uri.file("/tmp/a.txt"), panelStub());

		fire!(changed("previewLocalisation"));

		assert.deepStrictEqual(preview.reloads, []);
	});

	it("forces the loader session, so the page is not repainted from cache", () => {
		stub();
		const preview = new Watching(vscode.Uri.file("/tmp/a.txt"), panelStub());

		fire!(changed("gfxIndex"));

		assert.strictEqual(preview.reloads[0], true);
	});

	it("does not subscribe at all when nothing is declared", () => {
		stub();
		new Indifferent(vscode.Uri.file("/tmp/a.txt"), panelStub());

		assert.strictEqual(subscriptions, 0);
	});

	it("releases the subscription when the preview is disposed", () => {
		stub();
		const preview = new Watching(vscode.Uri.file("/tmp/a.txt"), panelStub());

		assert.strictEqual(subscriptions, 1);
		preview.dispose();

		assert.strictEqual(disposals, 1);
	});

	describe("what each preview watches", () => {
		// Pinned so emptying a list, or adding a preview that reads a setting without declaring it,
		// fails here rather than silently going stale on screen.
		const expected: [string, any, string[]][] = [
			[
				"focustree",
				focusTreePreviewDef,
				[
					"useConditionInFocus",
					"focusTreeLayout",
					"sharedFocusIndex",
					"inlayWindowGfxRoots",
					"gfxIndex",
					"localisationIndex",
					"previewLocalisation",
				],
			],
			["event", eventPreviewDef, ["previewLocalisation", "localisationIndex", "gfxIndex"]],
			[
				"idea",
				ideaPreviewDef,
				["previewLocalisation", "localisationIndex", "gfxIndex", "ideaSwapIndex"],
			],
			[
				"decision",
				decisionPreviewDef,
				["previewLocalisation", "localisationIndex", "gfxIndex"],
			],
			[
				"character",
				characterPreviewDef,
				["previewLocalisation", "localisationIndex", "gfxIndex"],
			],
			[
				"technology",
				technologyPreviewDef,
				[
					"technologyCountryIcons",
					"technologyGfxRoots",
					"gfxIndex",
					"localisationIndex",
					"previewLocalisation",
				],
			],
			["mio", mioPreviewDef, ["localisationIndex", "previewLocalisation", "gfxIndex"]],
			["gui", guiPreviewDef, ["gfxIndex", "localisationIndex", "previewLocalisation"]],
			// The gfx preview parses the open document and reads nothing else, so a setting change
			// cannot make its page stale.
			["gfx", gfxPreviewDef, []],
		];

		for (const [name, def, keys] of expected) {
			it(`${name} watches exactly its own settings`, () => {
				const watched = def.previewConstructor?.prototype
					?.reloadOnConfigurationChange as readonly string[] | undefined;
				assert.deepStrictEqual([...(watched ?? [])], keys);
			});
		}
	});
});
