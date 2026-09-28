import { HOIPartial } from "../../hoiformat/schema";
import { IconType, InstantTextBoxType } from "../../hoiformat/gui";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { localise } from "../localise";
import { calculateBBox, ParentInfo } from "../../util/hoi4gui/common";
import { RenderNodeCommonOptions, renderSprite } from "../../util/hoi4gui/nodecommon";
import { renderIcon } from "../../util/hoi4gui/icon";
import { renderInstantTextBox } from "../../util/hoi4gui/instanttextbox";
import { renderStandaloneWindow } from "../../util/hoi4gui/window";
import { BopLoaderResult, bopFillSprites } from "./loader";
import { BopWindowText, BopWindowView } from "./payload";

// The game's own width of the bar, for a mod whose progress bar sprites do not resolve.
const defaultBarWidth = 360;
const defaultBarHeight = 16;

export interface BopWindowInput {
	leftIcon?: string;
	rightIcon?: string;
}

/**
 * Draws powerbalanceview as the game does, with the elements its code fills in left as slots for
 * the webview: the side icons are the only code-driven part that does not move with the value, so
 * they are the only one drawn here.
 */
export async function renderBopWindow(
	input: BopWindowInput,
	loadResult: BopLoaderResult,
	styleTable: StyleTable,
): Promise<BopWindowView | undefined> {
	const resolved = loadResult.window;
	if (!resolved) {
		return undefined;
	}

	const options: RenderNodeCommonOptions = {
		getSprite: (sprite: string) => getSpriteByGfxName(sprite, loadResult.gfxFiles),
		styleTable,
		// Nothing in the window links anywhere: the preview's only links are its ranges, and those
		// go into the file it previews, never into the .gui or .gfx the window is drawn from.
		enableNavigator: false,
	};
	const absolute = styleTable.style("positionAbsolute", () => `position: absolute;`);
	const origin = styleTable.style("bop-slot-origin", () => `left: 0; top: 0;`);

	let bar = { x: 0, y: 0, width: defaultBarWidth };
	const texts: BopWindowText[] = [];

	// Where the game slides the window in on screen says nothing about the window itself, and would
	// only put empty space before it in a card.
	const window = { ...resolved.window, position: undefined };
	const rendered = await renderStandaloneWindow(window, styleTable, loadResult.gfxFiles, {
		enableNavigator: false,
		onRenderChild: async (type, child, parentInfo) => {
			const name = (child.name ?? "").toLowerCase();
			if (type === "icon") {
				const icon = child as HOIPartial<IconType>;
				switch (name) {
					case "left_power_icon":
					case "right_power_icon": {
						const sprite = name === "left_power_icon" ? input.leftIcon : input.rightIcon;
						return sprite ? renderIcon({ ...icon, spritetype: sprite }, parentInfo, options) : "";
					}
					case "power_balance_value": {
						const value = await renderValueSlot(icon, parentInfo, options, absolute, origin);
						bar = value.bar;
						return value.html;
					}
					case "position_marker":
						return `<div class="bop-slot-needle ${absolute} ${origin}">${await renderIcon(icon, parentInfo, options)}</div>`;
				}
			} else if (type === "instanttextbox") {
				const textbox = child as HOIPartial<InstantTextBoxType>;
				// Both texts are the webview's to fill: which one depends on the value, and both on
				// the localisation toggle.
				if (name === "power_balance_name" || name === "active_range_name") {
					return renderInstantTextBox({ ...textbox, text: "" }, parentInfo, {
						...options,
						rawText: true,
						classNames: name === "power_balance_name" ? "bop-slot-title" : "bop-slot-active-range",
					});
				}
				// Every other text the window writes itself, like the `balance_of_power_title`
				// header, is a key too, and follows the same toggle.
				const id = `${name}#${textbox._index ?? 0}`;
				texts.push({ id, text: await localise(textbox.text ?? "") });
				return renderInstantTextBox({ ...textbox, text: "" }, parentInfo, {
					...options,
					rawText: true,
					classNames: `bop-slot-text bop-slot-text-${normalizeForStyle(id)}`,
				});
			}
			return undefined;
		},
	});

	const templateParent: ParentInfo = {
		size: { width: rendered.width, height: rendered.height },
		orientation: "upper_left",
	};
	// The webview makes each copy of a tick open the range it marks.
	const template = async (icon: HOIPartial<IconType> | undefined, frame?: number) =>
		icon
			? renderIcon(frame === undefined ? icon : { ...icon, frame }, templateParent, options)
			: undefined;
	const { rangeBar, rangeIndicator } = loadResult.templates;
	const indicator0 = await template(rangeIndicator, 0);
	const indicator1 = await template(rangeIndicator, 1);

	return {
		// Wrapped at its own size, which the webview scales from.
		html: `<div class="bop-gui-window" style="width:${rendered.width}px;height:${rendered.height}px">${rendered.html}</div>`,
		width: rendered.width,
		height: rendered.height,
		bar,
		// Sorted, since the children render in parallel and the payload is hashed.
		texts: texts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		splitterHtml: await template(rangeBar),
		indicatorHtml: indicator0 !== undefined && indicator1 !== undefined ? [indicator0, indicator1] : undefined,
	};
}

// `power_balance_value` names no sprite: the game picks one of four progress bars by which side
// the value is on and whether it is moving. All four are drawn here, hidden, for the webview to
// show one and clip it to the stretch between the centre and the value. The range ticks go in a
// layer after it, so they sit on the fill and under the needle.
async function renderValueSlot(
	icon: HOIPartial<IconType>,
	parentInfo: ParentInfo,
	options: RenderNodeCommonOptions,
	absolute: string,
	origin: string,
): Promise<{ html: string; bar: { x: number; y: number; width: number } }> {
	const [x, y] = calculateBBox(icon, parentInfo);
	const variants = [
		["left", bopFillSprites.left],
		["right", bopFillSprites.right],
		["left-moving", bopFillSprites.leftMoving],
		["right-moving", bopFillSprites.rightMoving],
	] as const;
	const sprites = await Promise.all(variants.map(([, sprite]) => options.getSprite?.(sprite, "icon", icon.name)));
	const first = sprites.find((s) => s !== undefined);
	const width = first?.width ?? defaultBarWidth;
	const height = first?.height ?? defaultBarHeight;

	const fills = variants
		.map(([variant], i) => {
			const sprite = sprites[i];
			return sprite
				? renderSprite({ x: 0, y: 0 }, sprite, sprite, 0, 1, {
						styleTable: options.styleTable,
						classNames: `bop-slot-fill bop-slot-fill-${variant}`,
					})
				: "";
		})
		.join("");

	const slot = options.styleTable.oneTimeStyle(
		"bop-slot-value",
		() => `
            left: ${x}px;
            top: ${y}px;
            width: ${width}px;
            height: ${height}px;
        `,
	);

	return {
		html: `<div class="bop-slot-value ${absolute} ${slot}">${fills}</div><div class="bop-slot-marks ${absolute} ${origin}"></div>`,
		bar: { x, y, width },
	};
}
