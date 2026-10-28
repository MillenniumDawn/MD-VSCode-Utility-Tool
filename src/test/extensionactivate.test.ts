import * as assert from "assert";
import { activate, deactivate } from "../extension";

describe("extension activate", () => {
	it("activates and deactivates against the editor stub, registering its disposables", () => {
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
