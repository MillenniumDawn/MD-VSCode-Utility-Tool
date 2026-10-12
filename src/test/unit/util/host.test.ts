import * as assert from "assert";
import { Host, handOverHost, host } from "../../../util/host";

describe("util/host", () => {
	it("gives out what the extension handed over, and nothing before or after", () => {
		const api = { version: "1.74.0" } as Host;
		assert.throws(() => host(), /before the extension handed it over/);
		handOverHost(api);
		assert.strictEqual(host(), api);
		handOverHost(undefined);
		assert.throws(() => host(), /before the extension handed it over/);
	});
});
