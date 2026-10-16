import { createHash } from "crypto";
import { auditFixtures } from "./auditfixtures";
import * as assert from "assert";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import { convertFocusFileNodeToJson } from "../../../../previewdef/focustree/schema";
import { collectFocusWarnings, collectFocusWarningsAsync, formatFocusWarningReport, ParsedFocusFile } from "../../../../previewdef/focustree/warningreport";
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

// Golden hashes and RNG counts captured from 85aeb62 before either collection optimization.
describe("focus audit baseline equivalence", () => {
	for (const [enabled, hash, count] of [
		[true, "ab290bad40bb90b96f8acf788454a8ea28ef93fb06efd43b274712edd62b17db", 56],
		[false, "445dc3d383e51d40750448f23b78e9285541faae4e32875a99a48a2953cba087", 32],
	] as const) {
		it(`preserves mixed donors, malformed IDs and report order with conditions ${enabled}`, async () => {
			configure(enabled);
			const original = Math.random;
			try {
				for (const asynchronous of [false, true]) {
					let draws = 0;
					Math.random = () => ((++draws * 17) % 61) / 62;
					const input = auditFixtures.map(([path, text]) => parsed(path, text));
					const warnings = asynchronous ? await collectFocusWarningsAsync(input) : collectFocusWarnings(input);
					assert.ok(warnings);
					const report = formatFocusWarningReport(warnings, input.length);
					assert.strictEqual(createHash("sha256").update(report).digest("hex"), hash);
					assert.strictEqual(draws, count);
				}
			} finally {
				Math.random = original;
			}
		});
	}
});
