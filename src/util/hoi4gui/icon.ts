import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo } from "./common";
import { IconType } from "../../hoiformat/gui";
import { RenderNodeCommonOptions, placeSprite, renderSprite } from './nodecommon';

export interface RenderIconOptions extends RenderNodeCommonOptions {
}

export async function renderIcon(icon: HOIPartial<IconType>, parentInfo: ParentInfo, options: RenderIconOptions): Promise<string> {
    const placed = await placeSprite(icon, parentInfo, options);
    if (placed === undefined) {
        return '';
    }
    const { image, x, y, scale } = placed;

    return `<div
    start="${icon._token?.start}"
    end="${icon._token?.end}"
    class="
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('icon', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${image.width * scale}px;
            height: ${image.height * scale}px;
        `)}
    ">
        ${renderSprite({x: 0, y: 0}, image, image, icon.frame ?? 0, scale, options)}
    </div>`;
}
