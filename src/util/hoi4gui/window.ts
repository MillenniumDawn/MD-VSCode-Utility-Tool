import { ContainerWindowType } from "../../hoiformat/gui";
import { HOIPartial, toStringAsSymbolIgnoreCase } from "../../hoiformat/schema";
import { getSpriteByGfxName } from "../image/imagecache";
import { StyleTable, normalizeForStyle } from "../styletable";
import { getHeight, getWidth } from "./common";
import { RenderContainerWindowOptions, renderContainerWindow } from "./containerwindow";
import { RenderNodeCommonOptions } from "./nodecommon";

export interface RenderedWindow {
	html: string;
	width: number;
	height: number;
}

// Draws one top-level containerwindowtype, with its children, as HTML positioned from its own upper
// left corner. This is the whole of what it takes to turn a window into something on screen, and
// both the GUI preview and the decision preview -- which draws the window a `scripted_gui` category
// is replaced by -- need all of it, so it lives here rather than in either.
//
// The size is returned as well as the markup: a caller fitting the window into a card has to know
// how big it came out to scale it.
export async function renderStandaloneWindow(
	containerWindow: HOIPartial<ContainerWindowType>,
	styleTable: StyleTable,
	gfxFiles: string[],
): Promise<RenderedWindow> {
	const commonOptions: RenderNodeCommonOptions = {
		getSprite: (sprite: string) => getSpriteByGfxName(sprite, gfxFiles),
		styleTable,
	};

	const size = { width: 1920, height: 1080 };
	const width = getWidth(containerWindow.size);
	const height = getHeight(containerWindow.size);
	if (!width?._unit && width?._value !== undefined) {
		size.width = width._value;
	}
	if (!height?._unit && height?._value !== undefined) {
		size.height = height._value;
	}

	// A window positioned off the top or left of the screen is drawn where it would be, which puts
	// it outside anything the preview can show. Clamping it to the origin keeps it visible.
	const position = containerWindow.position
		? { ...containerWindow.position }
		: { x: undefined, y: undefined };
	if (position.x?._value !== undefined && position.x._value < 0) {
		position.x = { ...position.x, _value: 0 };
	}
	if (position.y?._value !== undefined && position.y._value < 0) {
		position.y = { ...position.y, _value: 0 };
	}

	const onRenderChild: RenderContainerWindowOptions["onRenderChild"] = async (
		type,
		child,
		parentInfo,
	) => {
		if (type === "containerwindow") {
			const childContainerWindow = child as HOIPartial<ContainerWindowType>;
			return await renderContainerWindow(childContainerWindow, parentInfo, {
				...commonOptions,
				classNames:
					"childcontainerwindow_" + normalizeForStyle(childContainerWindow.name ?? ""),
				enableNavigator: true,
				onRenderChild,
			});
		}
		return undefined;
	};

	const html = await renderContainerWindow(
		{
			...containerWindow,
			position,
			orientation: toStringAsSymbolIgnoreCase("upper_left"),
			origo: toStringAsSymbolIgnoreCase("upper_left"),
		},
		{
			size,
			orientation: "upper_left",
		},
		{
			...commonOptions,
			ignorePosition: false,
			enableNavigator: true,
			onRenderChild,
		},
	);

	return { html, width: size.width, height: size.height };
}
