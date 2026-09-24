import * as assert from "assert";
import * as vscode from "vscode";
import { renderGuiFile } from "../previewdef/gui/contentbuilder";
import { toNumberLike } from "../hoiformat/schema";

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "csp",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/interface/test.gui");

function loaderWithWindows(windows: any[]): any {
	return {
		load: async () => ({
			result: {
				guiFiles: [
					{
						file: "interface/test.gui",
						data: {
							guitypes: [{ containerwindowtype: windows, windowtype: [] }],
						},
					},
				],
				gfxFiles: [],
			},
		}),
	};
}

function minimalWindow(name: string, overrides: any = {}): any {
	return {
		name,
		position: { x: toNumberLike(0), y: toNumberLike(0) },
		size: { width: toNumberLike(200), height: toNumberLike(100) },
		containerwindowtype: [],
		windowtype: [],
		gridboxtype: [],
		icontype: [],
		instanttextboxtype: [],
		textboxtype: [],
		buttontype: [],
		checkboxtype: [],
		guibuttontype: [],
		_token: { start: 0, end: 10 },
		_index: 0,
		...overrides,
	};
}

describe("previewdef/gui contentbuilder", () => {
	it("renders no-containerwindow message for empty gui", async () => {
		const loader: any = {
			load: async () => ({
				result: {
					guiFiles: [
						{
							file: "test.gui",
							data: { guitypes: [{ containerwindowtype: [], windowtype: [] }] },
						},
					],
					gfxFiles: [],
				},
			}),
		};
		const html = await renderGuiFile(loader, uri, webview);
		assert.ok(html.includes("No containerwindowtype"));
	});

	it("renders single container window", async () => {
		const html = await renderGuiFile(
			loaderWithWindows([minimalWindow("win1")]),
			uri,
			webview,
		);
		assert.ok(html.includes("containerwindow_win1"));
		assert.ok(html.includes("win1"));
		assert.ok(html.includes("dragger"));
	});

	it("renders multiple container windows", async () => {
		const html = await renderGuiFile(
			loaderWithWindows([minimalWindow("a"), minimalWindow("b")]),
			uri,
			webview,
		);
		assert.ok(html.includes("containerwindow_a"));
		assert.ok(html.includes("containerwindow_b"));
		// Top bar selector should list both
		assert.ok(html.includes('<option value="containerwindow_a">a</option>'));
		assert.ok(html.includes('<option value="containerwindow_b">b</option>'));
	});

	it("escapes a window name that would otherwise end the inline script", async () => {
		// The parser accepts quoted identifiers, so a window name is workspace text. The HTML parser
		// ends the script at the first `</script`, whatever the JavaScript around it means.
		const hostileName = "win_</script><img src=x>";
		const html = await renderGuiFile(
			loaderWithWindows([minimalWindow(hostileName)]),
			uri,
			webview,
		);

		const script = /window\.containerWindowToggles = (.*?);<\/script>/s.exec(html);
		assert.ok(script, "expected the toggles payload script");
		assert.ok(!script![1]!.includes("</script"), script![1]!);
		const toggles = JSON.parse(script![1]!);
		assert.strictEqual(toggles[hostileName].name, hostileName);
	});

	it("escapes a window name carrying quotes and angle brackets in the selector and window id", async () => {
		// The parser accepts quoted identifiers, so a window name is workspace text; a raw `"`
		// would end the attribute and a raw `<img` would be markup rather than text.
		const hostileName = 'win" onload="x<img src=x>';
		const html = await renderGuiFile(
			loaderWithWindows([minimalWindow(hostileName)]),
			uri,
			webview,
		);

		assert.ok(!html.includes('value="containerwindow_win" '), html);
		assert.ok(!html.includes('id="containerwindow_win" '), html);
		assert.ok(html.includes('<option value="containerwindow_win&quot; onload=&quot;x&lt;img src=x&gt;">win&quot;&nbsp;onload=&quot;x&lt;img&nbsp;src=x&gt;</option>'), html);
		assert.ok(html.includes('id="containerwindow_win&quot; onload=&quot;x&lt;img src=x&gt;"'), html);
	});

	it("handles loader error gracefully", async () => {
		const badLoader: any = {
			load: async () => {
				throw new Error("gui boom");
			},
		};
		const html = await renderGuiFile(badLoader, uri, webview);
		assert.ok(html.includes("<pre>Error:&nbsp;gui&nbsp;boom</pre>"), html);
	});

	it("clamps negative position to 0", async () => {
		const win = minimalWindow("neg", {
			position: { x: toNumberLike(-50), y: toNumberLike(-20) },
		});
		const html = await renderGuiFile(loaderWithWindows([win]), uri, webview);
		// Renderer clamps negative x/y to 0, so should not contain -50
		assert.ok(!html.includes("left: -50px"));
	});

	it("renders nested child container windows via onRenderChild", async () => {
		const child = minimalWindow("child");
		const parentWin = minimalWindow("parent", {
			containerwindowtype: [child],
			windowtype: [],
		});
		const html = await renderGuiFile(
			loaderWithWindows([parentWin]),
			uri,
			webview,
		);
		assert.ok(html.includes("containerwindow_parent"));
		assert.ok(html.includes("containerwindow_child"));
	});
});
