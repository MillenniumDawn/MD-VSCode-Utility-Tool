import { HOIPartial, toNumberLike, toStringAsSymbolIgnoreCase } from "../../hoiformat/schema";
import { ParentInfo } from "./common";
import { ButtonType } from "../../hoiformat/gui";
import { RenderNodeCommonOptions, placeSprite, renderSprite } from './nodecommon';
import { renderInstantTextBox } from "./instanttextbox";

export interface RenderButtonOptions extends RenderNodeCommonOptions {
}

export async function renderButton(button: HOIPartial<ButtonType>, parentInfo: ParentInfo, options: RenderButtonOptions): Promise<string> {
    const placed = await placeSprite(button, parentInfo, options);
    if (placed === undefined) {
        return '';
    }
    const { image, x, y, scale } = placed;

    return `<div
    start="${button._token?.start}"
    end="${button._token?.end}"
    class="
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('button', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${image.width * scale}px;
            height: ${image.height * scale}px;
        `)}
    ">
        ${renderSprite({x: 0, y: 0}, image, image, button.frame ?? 0, scale, options)} 
        ${await renderInstantTextBox({
            ...button,
            position: { x: toNumberLike(0), y: toNumberLike(0) },
            bordersize: { x: toNumberLike(0), y: toNumberLike(0) },
            maxheight: toNumberLike(image.height * scale),
            maxwidth: toNumberLike(image.width * scale),
            font: button.buttonfont,
            text: button.buttontext ?? button.text,
            format: toStringAsSymbolIgnoreCase('center'),
            vertical_alignment: 'center',
            orientation: toStringAsSymbolIgnoreCase('upper_left')
        }, parentInfo, { ...options, enableNavigator: undefined })}
    </div>`;
}
