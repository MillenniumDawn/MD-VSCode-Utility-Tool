import "./setup";
import * as assert from "assert";
import { wireUpdateBody } from "../../../webviewsrc/util/updatebody";
import { vscode } from "../../../webviewsrc/util/vscode";

interface TestPayload {
	name: string;
}

// Every preview module loaded in this run has its own updateBody listener on window, and a message
// reaches all of them -- so the shared post log carries their reloads as well as this handler's.
// What this handler did is read as the difference one dispatch makes, never as the whole log.
const shellHtml = `
	<style id="test-server-styles">.old {}</style>
	<div id="testcontent"></div>`;

describe("webview/util/updatebody", () => {
	let previousBody = "";
	let posted: unknown[] = [];
	let applied: TestPayload[] = [];
	let rebuilds = 0;
	const originalPost = vscode.postMessage;

	before(() => {
		previousBody = document.body.innerHTML;
		// The handler is bound to window for the life of the run, so it is wired once and the
		// counters are what each test reads.
		(vscode as { postMessage: (message: unknown) => void }).postMessage = (message) => {
			posted.push(message);
		};
		wireUpdateBody<TestPayload>({
			contentId: "testcontent",
			styleId: "test-server-styles",
			dataKey: "testPreview",
			apply: (next) => {
				applied.push(next);
			},
			rebuild: () => {
				rebuilds++;
			},
		});
	});

	after(() => {
		document.body.innerHTML = previousBody;
		(vscode as { postMessage: typeof originalPost }).postMessage = originalPost;
	});

	beforeEach(() => {
		document.body.innerHTML = shellHtml;
		posted = [];
		applied = [];
		rebuilds = 0;
	});

	// How many messages the given dispatch put on the shared post log.
	function countPosts(dispatch: () => void): number {
		const before = posted.length;
		dispatch();
		return posted.length - before;
	}

	function push(data: unknown, styleCss?: string): void {
		window.dispatchEvent(
			new (window as any).MessageEvent("message", {
				data: { type: "updateBody", styleCss, data },
			}),
		);
	}

	it("swaps the payload and re-renders", () => {
		push({ testPreview: { name: "fresh" } });

		assert.deepStrictEqual(applied, [{ name: "fresh" }]);
		assert.strictEqual(rebuilds, 1);
	});

	it("takes the host's stylesheet along with the payload", () => {
		push({ testPreview: { name: "fresh" } }, ".new {}");

		assert.strictEqual(document.getElementById("test-server-styles")?.textContent, ".new {}");
	});

	// The webview may be showing the error page, which has no canvas to draw into. Re-rendering into
	// nothing would leave the reader on a stale page, so the host is asked for a full reload instead.
	it("asks for a reload when the page on screen has no canvas", () => {
		// One dispatch with the canvas in place measures what the other listeners contribute, so
		// the second dispatch can be read as the one reload this handler adds on top.
		const withCanvas = countPosts(() => push({ testPreview: { name: "fresh" } }));
		document.getElementById("testcontent")!.remove();
		const withoutCanvas = countPosts(() => push({ testPreview: { name: "fresh" } }));

		assert.strictEqual(withoutCanvas, withCanvas + 1);
		assert.deepStrictEqual(posted[posted.length - 1], { command: "reload" });
		// The reload replaces the re-render; it does not come on top of one.
		assert.strictEqual(rebuilds, 1);
	});

	it("ignores a message that is not an update", () => {
		window.dispatchEvent(
			new (window as any).MessageEvent("message", { data: { type: "somethingElse" } }),
		);
		window.dispatchEvent(new (window as any).MessageEvent("message", { data: undefined }));

		assert.strictEqual(rebuilds, 0);
	});

	// An update carrying only another preview's payload is not this preview's to act on.
	it("does nothing when the update carries no payload of its own", () => {
		push({ someOtherPreview: { name: "fresh" } });

		assert.deepStrictEqual(applied, []);
		assert.strictEqual(rebuilds, 0);
	});
});
