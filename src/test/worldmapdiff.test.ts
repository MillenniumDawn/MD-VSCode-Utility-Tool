import * as assert from 'assert';
import { isEqual } from 'lodash';
import { createItemHasher, diffItemList, defaultHashItem } from '../previewdef/worldmap/worldmapdiff';

function buildProvince(id: number, pathPoints: number): any {
    return {
        id,
        color: id * 7,
        coverZones: [{ x: id, y: id + 1, width: 10, height: 10 }],
        edges: [
            {
                to: id + 1,
                type: 'land',
                path: Array.from({ length: pathPoints }, (_, i) => ({ x: i, y: i * 2 })),
            },
        ],
    };
}

function oldIsEqualDiff(list: unknown[], cachedList: unknown[], listStart: number, listEnd: number): { start: number, end: number }[] | undefined {
    const changeMessagesCountLimit = 30;
    const messageCountLimit = 300;
    const ranges: { start: number, end: number }[] = [];

    let lastDifferenceStart: number | undefined = undefined;
    for (let i = listStart; i <= listEnd; i++) {
        if (i === listEnd || isEqual(list[i], cachedList[i])) {
            if (lastDifferenceStart !== undefined) {
                ranges.push({ start: lastDifferenceStart, end: i });
                if (ranges.length > changeMessagesCountLimit) {
                    return undefined;
                }
                lastDifferenceStart = undefined;
            }
        } else {
            if (lastDifferenceStart === undefined) {
                lastDifferenceStart = i;
            } else if (i - lastDifferenceStart >= messageCountLimit) {
                ranges.push({ start: lastDifferenceStart, end: i });
                if (ranges.length > changeMessagesCountLimit) {
                    return undefined;
                }
                lastDifferenceStart = i;
            }
        }
    }

    return ranges;
}

describe('previewdef/worldmap/worldmapdiff', () => {
    describe('JSON.stringify determinism', () => {
        it('serializes structurally identical items built independently to the same string', () => {
            const a = buildProvince(5, 20);
            const b = buildProvince(5, 20);
            assert.notStrictEqual(a, b);
            assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
        });

        it('serializes items with different content to different strings', () => {
            const a = buildProvince(5, 20);
            const b = buildProvince(5, 21);
            assert.notStrictEqual(JSON.stringify(a), JSON.stringify(b));
        });
    });

    describe('createItemHasher', () => {
        it('returns the same hash for undefined and for null, but distinguishes them', () => {
            const hash = createItemHasher();
            assert.strictEqual(hash(undefined), hash(undefined));
            assert.strictEqual(hash(null), hash(null));
            assert.notStrictEqual(hash(undefined), hash(null));
        });

        it('hashes structurally equal but distinct objects to the same value', () => {
            const hash = createItemHasher();
            const a = buildProvince(1, 5);
            const b = buildProvince(1, 5);
            assert.strictEqual(hash(a), hash(b));
        });

        it('hashes different content to different values', () => {
            const hash = createItemHasher();
            const a = buildProvince(1, 5);
            const b = buildProvince(1, 6);
            assert.notStrictEqual(hash(a), hash(b));
        });

        it('memoizes per object identity and does not re-serialize on repeated calls', () => {
            let callCount = 0;
            const countingSerialize = (item: unknown) => {
                callCount++;
                return JSON.stringify(item);
            };
            const hash = createItemHasher(countingSerialize);
            const item = buildProvince(1, 5);

            hash(item);
            assert.strictEqual(callCount, 1);

            hash(item);
            hash(item);
            assert.strictEqual(callCount, 1);
        });
    });

    describe('diffItemList', () => {
        it('produces no ranges for identical maps', () => {
            const list = [buildProvince(1, 3), buildProvince(2, 3), buildProvince(3, 3)];
            const cachedList = [buildProvince(1, 3), buildProvince(2, 3), buildProvince(3, 3)];
            const ranges = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(ranges, []);
        });

        it('does not diff at all when list and cachedList are the same reference', () => {
            const list = [buildProvince(1, 3)];
            let calls = 0;
            const countingHash = (item: unknown) => {
                calls++;
                return defaultHashItem(item);
            };
            const ranges = diffItemList(list, list, 0, list.length, countingHash);
            assert.deepStrictEqual(ranges, []);
            assert.strictEqual(calls, 0);
        });

        it('matches the old isEqual-based diff for a single changed item', () => {
            const list = [buildProvince(1, 3), buildProvince(2, 3), buildProvince(3, 3)];
            const cachedList = [buildProvince(1, 3), buildProvince(2, 3), buildProvince(3, 3)];
            list[1] = buildProvince(2, 99);

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(actual, expected);
            assert.deepStrictEqual(actual, [{ start: 1, end: 2 }]);
        });

        it('matches the old isEqual-based diff across several scattered changes', () => {
            const list = Array.from({ length: 20 }, (_, i) => buildProvince(i, 3));
            const cachedList = Array.from({ length: 20 }, (_, i) => buildProvince(i, 3));
            list[2] = buildProvince(2, 42);
            list[3] = buildProvince(3, 42);
            list[10] = buildProvince(10, 42);

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(actual, expected);
            assert.deepStrictEqual(actual, [{ start: 2, end: 4 }, { start: 10, end: 11 }]);
        });

        it('does not re-hash unchanged items already hashed by an earlier diff call', () => {
            let calls = 0;
            const countingSerialize = (item: unknown) => {
                calls++;
                return JSON.stringify(item);
            };
            const hash = createItemHasher(countingSerialize);

            const unchangedA = buildProvince(1, 3);
            const unchangedB = buildProvince(2, 3);
            const oldList = [unchangedA, unchangedB, buildProvince(3, 3)];
            const newList = [unchangedA, unchangedB, buildProvince(3, 4)];

            diffItemList(newList, oldList, 0, newList.length, hash);
            const callsAfterFirstDiff = calls;

            const newerList = [unchangedA, unchangedB, buildProvince(3, 5)];
            diffItemList(newerList, newList, 0, newerList.length, hash);

            // unchangedA/unchangedB are the same object references as before: no extra serialize calls for them.
            assert.strictEqual(calls, callsAfterFirstDiff + 1);
        });

        it('treats undefined entries the same as the old isEqual implementation', () => {
            const list = [buildProvince(1, 3), undefined, buildProvince(3, 3)];
            const cachedList = [buildProvince(1, 3), undefined, buildProvince(3, 3)];

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(actual, expected);
            assert.deepStrictEqual(actual, []);
        });

        it('treats null entries as distinct from undefined entries, matching the old implementation', () => {
            const list = [buildProvince(1, 3), null, buildProvince(3, 3)];
            const cachedList = [buildProvince(1, 3), undefined, buildProvince(3, 3)];

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(actual, expected);
            assert.deepStrictEqual(actual, [{ start: 1, end: 2 }]);
        });

        it('matches the old implementation when list length grows', () => {
            const cachedList = [buildProvince(1, 3), buildProvince(2, 3)];
            const list = [buildProvince(1, 3), buildProvince(2, 3), buildProvince(3, 3)];

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(actual, expected);
            assert.deepStrictEqual(actual, [{ start: 2, end: 3 }]);
        });

        it('matches the old implementation when list length shrinks', () => {
            const cachedList = [buildProvince(1, 3), buildProvince(2, 3), buildProvince(3, 3)];
            const list = [buildProvince(1, 3), buildProvince(2, 3)];

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(actual, expected);
        });

        it('returns undefined once the change range count exceeds the limit, like the old implementation', () => {
            const length = 200;
            const list = Array.from({ length }, (_, i) => buildProvince(i, 1));
            const cachedList = Array.from({ length }, (_, i) => buildProvince(i, 1));
            // Force every other item to differ so each change is its own 1-item range, well past the 30 range limit.
            for (let i = 0; i < length; i += 2) {
                list[i] = buildProvince(i, 2);
            }

            const expected = oldIsEqualDiff(list, cachedList, 0, list.length);
            const actual = diffItemList(list, cachedList, 0, list.length);
            assert.strictEqual(expected, undefined);
            assert.strictEqual(actual, undefined);
        });

        it('honors an explicit changeMessagesCountLimit, e.g. the remaining budget after earlier calls filled part of it', () => {
            // Three isolated single-item changes -> three separate ranges.
            const list = [buildProvince(0, 1), buildProvince(1, 1), buildProvince(2, 1), buildProvince(3, 1), buildProvince(4, 1)];
            const cachedList = [buildProvince(0, 1), buildProvince(1, 1), buildProvince(2, 1), buildProvince(3, 1), buildProvince(4, 1)];
            list[0] = buildProvince(0, 2);
            list[2] = buildProvince(2, 2);
            list[4] = buildProvince(4, 2);

            const full = diffItemList(list, cachedList, 0, list.length);
            assert.deepStrictEqual(full, [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }]);

            assert.strictEqual(diffItemList(list, cachedList, 0, list.length, defaultHashItem, 0), undefined);
            assert.strictEqual(diffItemList(list, cachedList, 0, list.length, defaultHashItem, 2), undefined);
            assert.deepStrictEqual(diffItemList(list, cachedList, 0, list.length, defaultHashItem, 3), full);
            assert.deepStrictEqual(diffItemList(list, cachedList, 0, list.length, defaultHashItem, 4), full);
        });
    });
});
