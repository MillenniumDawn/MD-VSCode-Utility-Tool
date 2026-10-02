import { StyleTable, normalizeForStyle } from "../util/styletable";
import { IconStyle } from "./sharedpayload";

export function spriteIconStyle(
	styleTable: StyleTable,
	keyPrefix: string,
	name: string,
	image: { uri: string; width: number; height: number },
	size?: { width: number; height: number },
): IconStyle {
	const styleKey = styleTable.style(keyPrefix + normalizeForStyle(name), () => `${size ? `
            width: ${size.width}px;
            height: ${size.height}px;` : ""}
            background-image: url(${image.uri});
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        `);
	return { styleKey, width: image.width, height: image.height };
}
