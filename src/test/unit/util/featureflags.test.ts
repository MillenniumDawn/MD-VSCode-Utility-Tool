import * as assert from "assert";
import { ConfigurationKey } from "../../../constants";
import * as featureflags from "../../../util/featureflags";
import { fresh, handOver } from "../host";

type Change = { affectsConfiguration(section: string): boolean };

// An editor with the given settings, counting how often they are read and keeping whoever asked
// to hear about changes to them.
function settings(values: Record<string, unknown>) {
	const state = { values, reads: 0, listeners: [] as ((change: Change) => void)[], disposed: 0 };
	handOver({
		workspace: {
			getConfiguration: () => {
				state.reads++;
				return state.values;
			},
			onDidChangeConfiguration: (listener: (change: Change) => void) => {
				state.listeners.push(listener);
				return { dispose: () => state.disposed++ };
			},
		},
	});
	return state;
}

describe("util/featureflags", () => {
	let flags: typeof featureflags;

	beforeEach(() => {
		flags = fresh<typeof featureflags>("../../util/featureflags");
	});

	it("reads the settings on first use, not as the file loads, and then keeps them", () => {
		assert.throws(() => flags.getFlags(), /before the extension handed it over/);
		const state = settings({ gfxIndex: true, previewLocalisation: "German" });
		const first = flags.getFlags();
		assert.strictEqual(flags.getFlags(), first);
		assert.deepStrictEqual([first.gfxIndex, first.previewLocalisation, state.reads], [true, "German", 1]);
	});

	it("falls back for the two settings that must have a value, and leaves the rest unset", () => {
		settings({});
		const { focusTreeLayout, focusTreePrerequisiteLines, ...rest } = flags.getFlags();
		assert.deepStrictEqual([focusTreeLayout, focusTreePrerequisiteLines], ["standard", "available"]);
		assert.deepStrictEqual(Object.values(rest).filter((value) => value !== undefined), []);
	});

	it("replaces the flags on a refresh, leaving an object read before it as it was", () => {
		const state = settings({ ideaPreview: true, focusTreeLayout: "gui" });
		const before = flags.getFlags();
		state.values = { ideaPreview: false };
		flags.refreshFeatureFlags();
		const after = flags.getFlags();
		assert.deepStrictEqual([before.ideaPreview, before.focusTreeLayout], [true, "gui"]);
		assert.deepStrictEqual([after.ideaPreview, after.focusTreeLayout], [false, "standard"]);
	});

	it("refreshes when the extension's own settings change, and only then", () => {
		const state = settings({ bopPreview: true });
		const registration = flags.registerFeatureFlags();
		flags.getFlags();

		state.values = { bopPreview: false };
		state.listeners[0]({ affectsConfiguration: (section) => section === "editor" });
		assert.strictEqual(flags.getFlags().bopPreview, true);
		state.listeners[0]({ affectsConfiguration: (section) => section === ConfigurationKey });
		assert.strictEqual(flags.getFlags().bopPreview, false);

		registration.dispose();
		assert.strictEqual(state.disposed, 1);
	});
});
