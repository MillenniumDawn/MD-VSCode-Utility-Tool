/*
 * FNV-1a, in one place.
 *
 * There were four copies of this: one in the content loader, one mirrored from it into the preview
 * base (with a comment saying so), one in the world map diff, and one in the index cache. Three of
 * them multiplied with `*`, which silently loses the low bits as soon as the product passes 2^53
 * and so does not produce the hash it claims to. Only the index cache's version used `Math.imul`,
 * and only it explained why.
 *
 * These are change-detection hashes, not checksums: the weaker versions still told you reliably
 * that something had changed, they just spread worse than FNV-1a is supposed to.
 */

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * 32-bit FNV-1a over the UTF-16 code units of `text`.
 *
 * `backwards` walks the string from the end, which is how the 64-bit form below gets two halves
 * that do not move together.
 */
export function fnv1a32(
	text: string,
	offsetBasis: number = FNV_OFFSET_BASIS,
	backwards: boolean = false,
): number {
	let hash = offsetBasis;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(backwards ? text.length - 1 - i : i);
		// `Math.imul`, not `*`: 32-bit multiplication, which a plain multiply cannot do once the
		// product passes 2^53.
		hash = Math.imul(hash, FNV_PRIME);
	}
	return hash >>> 0;
}

/**
 * 16 hex characters, from two 32-bit passes: one over the text, one over it backwards from a
 * different offset basis, so the two halves do not move together.
 */
export function fnv1a64Hex(text: string): string {
	return (
		hex8(fnv1a32(text, 0x811c9dc5, false)) +
		hex8(fnv1a32(text, 0x01000193, true))
	);
}

function hex8(value: number): string {
	return value.toString(16).padStart(8, "0");
}
