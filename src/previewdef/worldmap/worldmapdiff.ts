export type ItemHasher = (item: unknown) => string;

import { fnv1a32 } from "../../util/hash";

export function createItemHasher(serialize: (item: unknown) => string = JSON.stringify): ItemHasher {
    const cache = new WeakMap<object, string>();
    return (item: unknown): string => {
        if (item === undefined) {
            return 'u';
        }
        if (item === null) {
            return 'n';
        }

        const key = item as object;
        const cached = cache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const serialized = serialize(item);
        // Combine two independent 32-bit FNV-1a hashes so a collision can't silently drop a real change.
        const hash = fnv1a32(serialized) + ':' + fnv1a32(serialized, 2654435761);
        cache.set(key, hash);
        return hash;
    };
}

export const defaultHashItem = createItemHasher();

export interface ItemRange {
    start: number;
    end: number;
}

export function diffItemList(
    list: readonly unknown[],
    cachedList: readonly unknown[],
    listStart: number,
    listEnd: number,
    hashItem: ItemHasher = defaultHashItem,
    changeMessagesCountLimit = 30,
    messageCountLimit = 300,
): ItemRange[] | undefined {
    if (list === cachedList) {
        return [];
    }

    const ranges: ItemRange[] = [];
    let lastDifferenceStart: number | undefined = undefined;

    for (let i = listStart; i <= listEnd; i++) {
        if (i === listEnd || hashItem(list[i]) === hashItem(cachedList[i])) {
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
