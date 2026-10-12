import * as assert from "assert";
import { fnv1a32, fnv1a32Value, fnv1a64Hex } from "../../../util/hash";

const hex8 = (value: number) => value.toString(16).padStart(8, "0");

describe("util/hash", () => {
	describe("fnv1a32", () => {
		// The published FNV-1a test vectors.
		for (const [text, hash] of [["", 0x811c9dc5], ["a", 0xe40c292c], ["foobar", 0xbf9cf968]] as [string, number][]) {
			it(`hashes ${JSON.stringify(text)} to ${hex8(hash)}`, () => {
				assert.strictEqual(fnv1a32(text), hash);
			});
		}

		it("hashes a text backwards as it hashes the reversed text forwards", () => {
			assert.strictEqual(fnv1a32("focus", 7, true), fnv1a32("sucof", 7));
			assert.notStrictEqual(fnv1a32("focus", 7, true), fnv1a32("focus", 7));
		});
	});

	describe("fnv1a32Value", () => {
		it("hashes equal structures alike, to an unsigned 32-bit number", () => {
			const value = () => ({ id: "a", x: [1, "two", null, { deep: true }], y: undefined });
			const hash = fnv1a32Value(value());
			assert.strictEqual(hash, fnv1a32Value(value()));
			assert.ok(Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff);
		});

		const different: [string, unknown, unknown][] = [
			["a changed leaf", { a: [1, 2] }, { a: [1, 3] }],
			["the order of a list", [1, 2], [2, 1]],
			["the order of keys", { a: 1, b: 2 }, { b: 2, a: 1 }],
			["text moved between neighbours", { a: "ab", b: "c" }, { a: "a", b: "bc" }],
			["a value moved between keys", { a: 1, b: 2 }, { a: 2, b: 1 }],
			["a number and its text", 1, "1"],
			["null and its text", null, "null"],
			["nesting and flattening", [[1], 2], [1, 2]],
			["an empty list and an empty object", [], {}],
			["nothing and null", undefined, null],
			["a key holding nothing and no key", { a: undefined }, {}],
		];

		for (const [title, left, right] of different) {
			it(`tells apart ${title}`, () => {
				assert.notStrictEqual(fnv1a32Value(left), fnv1a32Value(right));
			});
		}
	});

	describe("fnv1a64Hex", () => {
		it("is the forward hash followed by a backward hash from another basis, in hex", () => {
			for (const text of ["", "common/national_focus/SOV.txt"]) {
				assert.strictEqual(fnv1a64Hex(text), hex8(fnv1a32(text)) + hex8(fnv1a32(text, 0x01000193, true)));
				assert.match(fnv1a64Hex(text), /^[0-9a-f]{16}$/);
			}
		});
	});
});
