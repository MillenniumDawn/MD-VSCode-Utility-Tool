import * as assert from "assert";
import { isSamePath, matchPathEnd } from "../../../util/nodecommon";

describe("util/nodecommon", () => {
	describe("matchPathEnd", () => {
		const paths: [string, string[], boolean][] = [
			["common/national_focus/SOV.txt", ["common", "national_focus", "*"], true],
			["C:\\mod\\Common\\National_Focus\\SOV.txt", ["common", "national_focus", "*"], true],
			["mod/common/ideas/SOV.txt", ["common", "national_focus", "*"], false],
			["mod/history/national_focus/SOV.txt", ["common", "national_focus", "*"], false],
			["mod/map/default.map", ["map", "default.map"], true],
			["mod/map/other.map", ["map", "default.map"], false],
			["mod/events/sub/SOV.txt", ["events", "*"], false],
			["SOV.txt", ["common", "SOV.txt"], false],
			["anything/at/all", [], true],
		];

		for (const [pathname, segments, expected] of paths) {
			it(`${expected ? "matches" : "does not match"} ${pathname} against ${segments.join("/") || "no segments"}`, () => {
				assert.strictEqual(matchPathEnd(pathname, segments), expected);
			});
		}
	});

	describe("isSamePath", () => {
		const pairs: [string, string, boolean][] = [
			["/mod/common", "/mod/common", true],
			["/mod/Common", "/MOD/common", true],
			["/mod/common/", "/mod/common", true],
			["/mod/common/../events", "/mod/events", true],
			["/mod/common", "/mod/events", false],
			["/mod/common", "/mod", false],
		];

		for (const [left, right, expected] of pairs) {
			it(`${expected ? "takes" : "does not take"} ${left} and ${right} for one path`, () => {
				assert.strictEqual(isSamePath(left, right), expected);
			});
		}
	});
});
