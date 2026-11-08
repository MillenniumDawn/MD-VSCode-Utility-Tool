import * as assert from "assert";
import { sortItems } from "../../../../../previewdef/worldmap/loader/common";

type Sortable = { id: number };

function callSortItems(
	items: Sortable[],
	reassignMinusOneId = true,
	badId = -1,
): {
	sorted: Sortable[];
	badId: number;
	tooLargeIds: number[];
	conflicts: [Sortable, Sortable, number][];
	notExistRanges: [number, number][];
	invalidIds: [Sortable, number, number][];
} {
	const tracked = {
		tooLargeIds: [] as number[],
		conflicts: [] as [Sortable, Sortable, number][],
		notExistRanges: [] as [number, number][],
		invalidIds: [] as [Sortable, number, number][],
	};
	const { sorted, badId: resultingBadId } = sortItems(
		items,
		10,
		(maxId) => tracked.tooLargeIds.push(maxId),
		(newItem, existingItem, displacedBadId) =>
			tracked.conflicts.push([newItem, existingItem, displacedBadId]),
		(startId, endId) => tracked.notExistRanges.push([startId, endId]),
		reassignMinusOneId,
		badId,
		(item, displacedBadId, invalidId) =>
			tracked.invalidIds.push([item, displacedBadId, invalidId]),
	);
	return { sorted, badId: resultingBadId, ...tracked };
}

describe("previewdef/worldmap/loader/common sortItems malformed ids", () => {
	it("moves a fractional id to a fresh bad id instead of throwing out of new Array", () => {
		const first: Sortable = { id: 1 };
		const fractional: Sortable = { id: 1.5 };
		const { sorted, badId, invalidIds, conflicts, notExistRanges, tooLargeIds } =
			callSortItems([first, fractional]);

		assert.deepStrictEqual(tooLargeIds, []);
		assert.deepStrictEqual(conflicts, []);
		assert.deepStrictEqual(notExistRanges, []);
		assert.deepStrictEqual(invalidIds, [[fractional, -1, 1.5]]);
		assert.strictEqual(sorted[1], first);
		assert.strictEqual(sorted[-1], fractional);
		assert.strictEqual(fractional.id, -1);
		assert.strictEqual(badId, -2);
		assert.strictEqual(sorted.length, 2);
	});

	it("moves a NaN id the same way", () => {
		const valid: Sortable = { id: 2 };
		const invalid: Sortable = { id: NaN };
		const { sorted, badId, invalidIds } = callSortItems([invalid, valid]);

		assert.deepStrictEqual(invalidIds, [[invalid, -1, NaN]]);
		assert.strictEqual(sorted[2], valid);
		assert.strictEqual(sorted[-1], invalid);
		assert.strictEqual(badId, -2);
	});

	it("survives input where every id is malformed", () => {
		const first: Sortable = { id: NaN };
		const second: Sortable = { id: 0.5 };
		const { sorted, badId, invalidIds } = callSortItems([first, second]);

		assert.deepStrictEqual(invalidIds, [
			[first, -1, NaN],
			[second, -2, 0.5],
		]);
		assert.strictEqual(sorted.length, 1);
		assert.strictEqual(sorted[-1], first);
		assert.strictEqual(sorted[-2], second);
		assert.strictEqual(badId, -3);
	});

	it("still reassigns id -1, but displaces any other negative id", () => {
		const noId: Sortable = { id: -1 };
		const negative: Sortable = { id: -5 };
		const valid: Sortable = { id: 1 };
		const { sorted, badId, invalidIds } = callSortItems([
			noId,
			valid,
			negative,
		]);

		assert.deepStrictEqual(invalidIds, [[negative, -2, -5]]);
		assert.strictEqual(noId.id, -1);
		assert.strictEqual(sorted[-1], noId);
		assert.strictEqual(sorted[-2], negative);
		assert.strictEqual(sorted[1], valid);
		assert.strictEqual(badId, -3);
	});

	it("keeps the caller's own synthetic negative ids in place and round-trips the bad id", () => {
		const synthetic1: Sortable = { id: -1 };
		const synthetic2: Sortable = { id: -2 };
		const valid: Sortable = { id: 3 };
		const { sorted, badId, invalidIds } = callSortItems(
			[synthetic1, synthetic2, valid],
			false,
			-3,
		);

		assert.deepStrictEqual(invalidIds, []);
		assert.strictEqual(sorted[-1], synthetic1);
		assert.strictEqual(sorted[-2], synthetic2);
		assert.strictEqual(sorted[3], valid);
		assert.strictEqual(synthetic1.id, -1);
		assert.strictEqual(synthetic2.id, -2);
		assert.strictEqual(badId, -3);
		assert.strictEqual(sorted.length, 4);
	});

	it("displaces a foreign id below what the caller already issued", () => {
		const foreign: Sortable = { id: -5 };
		const valid: Sortable = { id: 1 };
		const { sorted, badId, invalidIds } = callSortItems(
			[foreign, valid],
			false,
			-1,
		);

		assert.deepStrictEqual(invalidIds, [[foreign, -1, -5]]);
		assert.strictEqual(sorted[-1], foreign);
		assert.strictEqual(sorted[1], valid);
		assert.strictEqual(badId, -2);
	});

	it("sizes the array from placeable ids only, so the too-large check sees the rest unchanged", () => {
		const { tooLargeIds, invalidIds } = callSortItems([
			{ id: NaN },
			{ id: 2 },
		]);
		assert.deepStrictEqual(tooLargeIds, []);
		assert.strictEqual(invalidIds.length, 1);

		const atLimit = callSortItems([{ id: 10 }]);
		assert.deepStrictEqual(atLimit.tooLargeIds, []);
		assert.strictEqual(atLimit.sorted.length, 11);
		assert.strictEqual(atLimit.sorted[10]?.id, 10);

		const overLimit = callSortItems([{ id: NaN }, { id: 11 }]);
		assert.deepStrictEqual(overLimit.tooLargeIds, [11]);
	});

	it("displaces a supplied id equal to the entry badId in caller-managed mode", () => {
		const boundary: Sortable = { id: -1 };
		const { sorted, badId, invalidIds } = callSortItems([boundary], false, -1);

		assert.deepStrictEqual(invalidIds, [[boundary, -1, -1]]);
		assert.strictEqual(boundary.id, -1);
		assert.strictEqual(sorted[-1], boundary);
		assert.strictEqual(badId, -2);
	});

	it("displaces a supplied id equal to a custom entry badId too", () => {
		const boundary: Sortable = { id: -3 };
		const { sorted, badId, invalidIds } = callSortItems([boundary], false, -3);

		assert.deepStrictEqual(invalidIds, [[boundary, -3, -3]]);
		assert.strictEqual(boundary.id, -3);
		assert.strictEqual(sorted[-3], boundary);
		assert.strictEqual(badId, -4);
	});

	it("displaces every id of caller-managed [NaN, -2] with entry badId -1", () => {
		const nanRow: Sortable = { id: NaN };
		const two: Sortable = { id: -2 };
		const { sorted, badId, invalidIds } = callSortItems([nanRow, two], false, -1);

		assert.deepStrictEqual(invalidIds, [
			[nanRow, -1, NaN],
			[two, -2, -2],
		]);
		assert.strictEqual(sorted[-1], nanRow);
		assert.strictEqual(sorted[-2], two);
		assert.strictEqual(badId, -3);
	});

	it("keeps gaps, conflicts and empty input working as before", () => {
		const loser: Sortable = { id: 2 };
		const winner: Sortable = { id: 2 };
		const { sorted, badId, conflicts, notExistRanges } = callSortItems([
			{ id: 0 },
			loser,
			winner,
		]);

		assert.deepStrictEqual(conflicts, [[winner, loser, -1]]);
		assert.strictEqual(sorted[2], winner);
		assert.strictEqual(loser.id, -1);
		assert.strictEqual(sorted[-1], loser);
		assert.deepStrictEqual(notExistRanges, [[1, 1]]);
		assert.strictEqual(badId, -2);

		const empty = callSortItems([]);
		assert.strictEqual(empty.sorted.length, 1);
		assert.strictEqual(empty.sorted[0], undefined);
		assert.strictEqual(empty.badId, -1);
	});
});
