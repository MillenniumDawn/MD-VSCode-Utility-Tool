import * as assert from "assert";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import { convertFocusFileNodeToJson } from "../../../../previewdef/focustree/schema";
import { collectFocusWarnings, collectFocusWarningsAsync, ParsedFocusFile } from "../../../../previewdef/focustree/warningreport";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { handOver } from "../../host";

function parsed(path: string, text: string): ParsedFocusFile {
	return { path, file: convertFocusFileNodeToJson(parseHoi4File(text), {}) };
}
function configure(useConditionInFocus: boolean): void {
	handOver({ workspace: { getConfiguration: () => ({ useConditionInFocus }) } });
	refreshFeatureFlags();
}
const files = () => [
	parsed("donor.txt", "shared_focus = { id = a x = 0 y = 0 } shared_focus = { id = b x = 0 y = 0 }"),
	parsed("host.txt", "focus_tree = { id = country shared_focus = a shared_focus = b focus = { id = c x = 1 y = 0 } }"),
];

describe("focus audit cooperative collection", () => {
	let now: typeof Date.now;
	beforeEach(() => { now = Date.now; configure(true); });
	afterEach(() => { Date.now = now; });

	function sliceEveryFile(): void {
		let clock = 0;
		Date.now = () => (clock += 9);
	}

	it("preserves synchronous report order and services other event-loop work", async () => {
		sliceEveryFile();
		const input = files();
		const expected = collectFocusWarnings(input);
		let serviced = false;
		setImmediate(() => { serviced = true; });
		assert.deepStrictEqual(await collectFocusWarningsAsync(input), expected);
		assert.ok(serviced);
	});

	it("keeps the captured condition setting across yields", async () => {
		sliceEveryFile();
		const input = files();
		const expected = collectFocusWarnings(input);
		configure(false);
		assert.notDeepStrictEqual(collectFocusWarnings(input), expected);
		configure(true);
		setImmediate(() => configure(false));
		assert.deepStrictEqual(await collectFocusWarningsAsync(input), expected);
	});

	it("does not start a cancelled collection", async () => {
		const input = files();
		Object.defineProperty(input[0], "file", { get: () => { throw new Error("must not read"); } });
		assert.strictEqual(await collectFocusWarningsAsync(input, { isCancellationRequested: true }), undefined);
	});

	for (const turns of [1, 2, 3]) {
		it(`discards partial results when cancelled after ${turns} file work units`, async () => {
			sliceEveryFile();
			const token = { isCancellationRequested: false };
			const cancelAfter = (left: number): void => {
				setImmediate(() => {
					if (left === 1) { token.isCancellationRequested = true; }
					else { cancelAfter(left - 1); }
				});
			};
			cancelAfter(turns);
			assert.strictEqual(await collectFocusWarningsAsync(files(), token), undefined);
		});
	}

	it("services cancellation before returning even an empty report", async () => {
		const token = { isCancellationRequested: false };
		setImmediate(() => { token.isCancellationRequested = true; });
		assert.strictEqual(await collectFocusWarningsAsync([], token), undefined);
	});
});
