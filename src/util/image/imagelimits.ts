import { UserError } from "../common";

// Millennium Dawn's largest images are about 20 Mpx. At the 24 Mpx limit the RGBA raster is 96 MB
// and PNG encoding builds an equal-sized filtered copy of it, so about 192 MB coexist at the encode
// peak, before the compressed output (as large again for noise). Valid images keep modest headroom.
export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 24_000_000;

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
