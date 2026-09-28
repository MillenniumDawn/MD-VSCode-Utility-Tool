import { HOIPartial } from "../../hoiformat/schema";
import { ContainerWindowType, GridBoxType, IconType, InstantTextBoxType } from "../../hoiformat/gui";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { htmlEscape } from "../../util/escape";
import { localise } from "../localise";
import { calculateBBox, ParentInfo } from "../../util/hoi4gui/common";
import { RenderNodeCommonOptions, renderSprite } from "../../util/hoi4gui/nodecommon";
import { renderIcon } from "../../util/hoi4gui/icon";
import { renderInstantTextBox } from "../../util/hoi4gui/instanttextbox";
import { renderStandaloneWindow } from "../../util/hoi4gui/window";
import { renderContainerWindow } from "../../util/hoi4gui/containerwindow";
import { BopLoaderResult, bopFillSprites } from "./loader";
import { BopWindowText, BopWindowView } from "./payload";

// The game's own width of the bar, for a mod whose progress bar sprites do not resolve.
const defaultBarWidth = 360;
const defaultBarHeight = 16;

// The game's own slot height of `decision_grid`, for a mod whose grid names none.
const defaultDecisionSlotHeight = 40;

export interface BopWindowInput {
	leftIcon?: string;
	rightIcon?: string;
	// The decisions of the BoP's category, in the order the grid lists them.
	decisions: BopWindowDecision[];
}

export interface BopWindowDecision {
	// The sprite the decision's first icon names.
	icon?: string;
	// What the row writes where the game writes the cost.
	cost?: string;
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
			if (type === "gridbox" && name === "decision_grid") {
				return renderDecisionGrid(child as HOIPartial<GridBoxType>, parentInfo, input.decisions, loadResult, options);
			}
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

// `decision_grid` is filled by the game's code with one `decision_item` per decision of the BoP's
// category. The rows are drawn here, each in a `.bop-decision` the webview names and links, in a
// layer that scrolls when there are more rows than the container shows, as the game's does.
async function renderDecisionGrid(
	grid: HOIPartial<GridBoxType>,
	parentInfo: ParentInfo,
	decisions: BopWindowDecision[],
	loadResult: BopLoaderResult,
	options: RenderNodeCommonOptions,
): Promise<string> {
	if (decisions.length === 0) {
		return "";
	}
	const [x, y, width] = calculateBBox(grid, parentInfo);
	const slotWidth = grid.slotsize?.width?._value ?? width;
	const slotHeight = grid.slotsize?.height?._value ?? defaultDecisionSlotHeight;
	const slot: ParentInfo = { size: { width: slotWidth, height: slotHeight }, orientation: "upper_left" };
	const item = loadResult.decisionItem?.window;

	const rows = await Promise.all(
		decisions.map(async (decision, index) => {
			const content = item
				? await renderDecisionItem(item, slot, decision, options)
				: await renderPlainDecisionRow(slot, decision, options);
			return `<div class="bop-decision" data-index="${index}" style="position:absolute;left:0;top:${index * slotHeight}px;width:${slotWidth}px;height:${slotHeight}px">${content}</div>`;
		}),
	);

	const height = Math.max(parentInfo.size.height - y, slotHeight);
	return `<div class="bop-decision-grid" style="position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;overflow-x:hidden;overflow-y:auto"><div style="position:relative;height:${decisions.length * slotHeight}px">${rows.join("")}</div></div>`;
}

async function renderDecisionItem(
	item: HOIPartial<ContainerWindowType>,
	slot: ParentInfo,
	decision: BopWindowDecision,
	options: RenderNodeCommonOptions,
): Promise<string> {
	return renderContainerWindow(item, slot, {
		...options,
		onRenderChild: async (type, child, parentInfo) => {
			const name = (child.name ?? "").toLowerCase();
			if (type === "icon") {
				switch (name) {
					case "icon":
						return decision.icon
							? renderIcon({ ...(child as HOIPartial<IconType>), spritetype: decision.icon }, parentInfo, options)
							: undefined;
					// A mission's timer and a targeted decision's flag need a running game.
					case "btn_progress_good":
					case "btn_progress_bad":
					case "target_flag":
					case "target_flag_frame":
						return "";
				}
			} else if (type === "instanttextbox") {
				const textbox = child as HOIPartial<InstantTextBoxType>;
				if (name === "name_text") {
					return renderInstantTextBox({ ...textbox, text: "" }, parentInfo, {
						...options,
						rawText: true,
						classNames: "bop-decision-name",
					});
				}
				if (name === "cost_and_timer_text") {
					return renderInstantTextBox({ ...textbox, text: decision.cost ?? "" }, parentInfo, {
						...options,
						rawText: true,
					});
				}
			}
			return undefined;
		},
	});
}

// For a mod and install without `decision_item`: the icon, the name and the cost on one line.
async function renderPlainDecisionRow(
	slot: ParentInfo,
	decision: BopWindowDecision,
	options: RenderNodeCommonOptions,
): Promise<string> {
	const sprite = decision.icon ? await options.getSprite?.(decision.icon, "icon", undefined) : undefined;
	const image = sprite?.image;
	const icon = image
		? `<img class="bop-decision-icon" src="${image.uri}" style="height:${slot.size.height}px">`
		: "";
	return `<div class="bop-decision-plain">${icon}<span class="bop-decision-name"></span><span class="bop-decision-cost">${htmlEscape(decision.cost ?? "")}</span></div>`;
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
