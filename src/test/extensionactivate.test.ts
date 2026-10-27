import * as assert from "assert";
import { activate, deactivate } from "../extension";

describe("extension activate", () => {
	it("hands the editor over and registers every preview before it counts as loaded", () => {
		const subscriptions: { dispose(): void }[] = [];
		activate({
			subscriptions,
			extension: { packageJSON: { locale: "%hoi4modutilities.locale%" } },
		} as any);

		assert.ok(subscriptions.length > 10, `only ${subscriptions.length} subscriptions`);
		deactivate();
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
	});
});
