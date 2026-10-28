import * as assert from "assert";
import { mock } from "node:test";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import * as contentbuilder from "../../../../previewdef/focustree/contentbuilder";
import { focusTreePreviewDef } from "../../../../previewdef/focustree";
import * as vsccommon from "../../../../util/vsccommon";
import { handOver } from "../../host";

const relative = "common/national_focus/test.txt";

function listen(posts: unknown[]): { page: any; fire(message: unknown): void } {
	const disposable = { dispose: () => undefined };
	let listener = (_message: unknown): void => undefined;
	const page = {
		webview: {
			html: "",
			cspSource: "",
			asWebviewUri: (uri: unknown) => uri,
			postMessage: async (message: unknown) => {
				posts.push(message);
				return true;
			},
			onDidReceiveMessage: (next: (message: unknown) => void) => {
				listener = next;
				return disposable;
			},
		},
		visible: true,
		onDidChangeViewState: () => disposable,
		onDidDispose: () => disposable,
	};
	return { page, fire: (message) => listener(message) };
}

function document(text: string) {
	return {
		uri: { scheme: "file", path: `/mod/${relative}`, fsPath: `/mod/${relative}` },
		getText: () => text,
		positionAt: (offset: number) => ({ offset }),
	};
}

describe("previewdef/focustree messages", () => {
	const posts: unknown[] = [];
	let preview: any;
	let fire: (message: unknown) => void;
	const warnings: string[] = [];
	const edits: unknown[] = [];
	const clipboard: string[] = [];
	const infos: string[] = [];

	beforeEach(() => {
		posts.length = 0;
		warnings.length = 0;
		edits.length = 0;
		clipboard.length = 0;
		infos.length = 0;
		const listened = listen(posts);
		fire = listened.fire;
		handOver({
			EventEmitter: class {
				event = () => ({ dispose: () => undefined });
				fire() {}
				dispose() {}
			},
			workspace: {
				getConfiguration: () => ({}),
				onDidChangeConfiguration: () => ({ dispose: () => undefined }),
				applyEdit: async (edit: unknown) => {
					edits.push(edit);
					return true;
				},
				openTextDocument: async () => document(""),
			},
			window: {
				createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
				showWarningMessage: async (message: string) => {
					warnings.push(message);
				},
				showInformationMessage: async (message: string) => {
					infos.push(message);
				},
			},
			env: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } },
			WorkspaceEdit: class {
				replace(...args: unknown[]) {
					this.replaced = args;
				}
				replaced?: unknown[];
			},
			Range: class {
				constructor(readonly start: unknown, readonly end: unknown) {}
			},
		} as any);
		mock.method(vsccommon, "getRelativePathInWorkspace", () => relative);
		mock.method(vsccommon, "getDocumentByUri", () => document(treeText()));
		preview = new (focusTreePreviewDef as any).previewConstructor(
			{ scheme: "file", path: `/mod/${relative}`, fsPath: `/mod/${relative}` },
			listened.page,
		);
	});

	afterEach(() => {
		mock.restoreAll();
	});

	function treeText(): string {
		return "focus_tree = {\n    id = test_tree\n}\n";
	}

	function treeStart(): number {
		const root = parseHoi4File(treeText());
		const tree = (root.value as { name?: string; nameToken?: { start: number } }[])
			.find((node) => node.name === "focus_tree");
		assert.ok(tree?.nameToken, "the fixture tree has no start");
		return tree.nameToken.start;
	}

	it("restores the last update and the icon css when the page says it is ready", () => {
		preview.latestUpdateMessage = { type: "update", data: { focusTrees: [] } };
		preview.lastPushedIconCss = ".icon { }";
		preview.lastPushedIconGeneration = preview.iconRenderGeneration;

		fire({ command: "ready" });

		assert.deepStrictEqual(posts, [
			{ type: "update", data: { focusTrees: [] } },
			{ type: "iconStyles", css: ".icon { }" },
		]);
	});

	it("writes a dropped continuous focus position back, and refuses one the file no longer has", async () => {
		fire({
			command: "setContinuousFocusPosition",
			file: relative,
			start: treeStart(),
			treeId: "test_tree",
			x: 12.4,
			y: -3,
		});
		await new Promise((resolve) => setImmediate(resolve));

		assert.strictEqual(edits.length, 1);
		assert.strictEqual(warnings.length, 0);

		fire({
			command: "setContinuousFocusPosition",
			file: relative,
			start: 0,
			treeId: "gone",
			x: 1,
			y: 1,
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.strictEqual(warnings.length, 1);

		fire({ command: "setContinuousFocusPosition", file: "other.txt", x: 1, y: 1 });
		await new Promise((resolve) => setImmediate(resolve));
		assert.strictEqual(edits.length, 1);
	});

	it("copies the warnings the page posted, and says so when there are none", async () => {
		fire({ command: "copyWarnings", treeId: "test_tree", warnings: [] });
		fire({
			command: "copyWarnings",
			treeId: "test_tree",
			warnings: [{ source: "a", text: "overlaps b" }],
		});
		await new Promise((resolve) => setImmediate(resolve));

		assert.strictEqual(infos.length, 2);
		assert.strictEqual(clipboard.length, 1);
		assert.ok(clipboard[0]?.includes("overlaps b"), clipboard[0]);
	});

	it("streams icons after a full page, and drops a push the page is no longer waiting for", async () => {
		assert.ok(preview.getLoadingShellHtml().length > 0);
		mock.method(contentbuilder, "buildFocusTreePayload", async () => ({
			styleTable: { toRawCss: () => ".resolved { }" },
		}));
		let releaseReady!: () => void;
		preview.webviewReady = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		const generation = preview.iconRenderGeneration;
		const dropped = preview.pushIconStyles(generation);
		preview.iconRenderGeneration = generation + 1;
		releaseReady();
		await dropped;
		assert.ok(posts.every((message) => (message as { type?: string }).type !== "iconStyles"));

		await preview.pushIconStyles(preview.iconRenderGeneration);
		await preview.repushResolvedIconStyles();
		assert.ok(
			posts.filter((message) => (message as { type?: string }).type === "iconStyles").length >= 2,
			JSON.stringify(posts),
		);
	});
});
