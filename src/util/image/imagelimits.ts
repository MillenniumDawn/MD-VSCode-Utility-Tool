import { UserError } from "../common";

// The widest texture Millennium Dawn ships is 15360 px on a side and the largest is 20 Mpx; the
// bound leaves headroom while keeping the decoded RGBA buffer at 256 MB or less.
export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 8192 * 8192;

export function assertImageDimensions(
	width: number,
	height: number,
	kind: string,
): void {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1
	) {
		throw new UserError(`${kind} image size ${width}x${height} is not valid`);
	}
	if (
		width > MAX_IMAGE_DIMENSION ||
		height > MAX_IMAGE_DIMENSION ||
		width * height > MAX_IMAGE_PIXELS
	) {
		throw new UserError(
			`${kind} image size ${width}x${height} exceeds the supported maximum (${MAX_IMAGE_DIMENSION} per side, ${MAX_IMAGE_PIXELS} pixels)`,
		);
	}
}
