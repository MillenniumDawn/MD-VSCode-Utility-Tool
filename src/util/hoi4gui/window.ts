import { ContainerWindowType } from "../../hoiformat/gui";
import { HOIPartial, toStringAsSymbolIgnoreCase } from "../../hoiformat/schema";
import { getSpriteByGfxName } from "../image/imagecache";
import { htmlEscape } from "../escape";
import { StyleTable, normalizeForStyle } from "../styletable";
import { ParentInfo, calculateBBox, getHeight, getWidth } from "./common";
import { RenderContainerWindowOptions, renderContainerWindow } from "./containerwindow";
import { RenderNodeCommonOptions } from "./nodecommon";

export interface RenderStandaloneWindowOptions {
	// Drawn in place of the default for any child it returns markup for, at every depth. A preview
	// uses it for the elements the game fills in from code: a sprite name, a text, a position.
	onRenderChild?: RenderContainerWindowOptions["onRenderChild"];
	// The .gui file the window came from. Its elements carry offsets into that file, and without the
	// file a click on one would jump to those offsets in whatever file the preview is showing.
	file?: string;
	// Whether a click on an element opens its definition. On unless a preview turns it off: one
	// that links only into the file it previews has no use for links into the .gui.
	enableNavigator?: boolean;
}

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
// how big it came out to scale it. It is the extent from the origin, the window's position included,
// since that is the box the markup needs to be seen whole.
export async function renderStandaloneWindow(
	containerWindow: HOIPartial<ContainerWindowType>,
	styleTable: StyleTable,
	gfxFiles: string[],
	windowOptions: RenderStandaloneWindowOptions = {},
): Promise<RenderedWindow> {
	const enableNavigator = windowOptions.enableNavigator ?? true;
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
		const overridden = await windowOptions.onRenderChild?.(type, child, parentInfo);
		if (overridden !== undefined) {
			return overridden;
		}
		if (type === "containerwindow") {
			const childContainerWindow = child as HOIPartial<ContainerWindowType>;
			return await renderContainerWindow(childContainerWindow, parentInfo, {
				...commonOptions,
				classNames:
					"childcontainerwindow_" + normalizeForStyle(childContainerWindow.name ?? ""),
				enableNavigator,
				onRenderChild,
			});
		}
		return undefined;
	};

	const positionedWindow: HOIPartial<ContainerWindowType> = {
		...containerWindow,
		position,
		orientation: toStringAsSymbolIgnoreCase("upper_left"),
		origo: toStringAsSymbolIgnoreCase("upper_left"),
	};
	const parentInfo: ParentInfo = {
		size,
		orientation: "upper_left",
	};

	let html = await renderContainerWindow(positionedWindow, parentInfo, {
		...commonOptions,
		ignorePosition: false,
		enableNavigator,
		onRenderChild,
	});

	if (windowOptions.file !== undefined) {
		html = withNavigatorFile(html, windowOptions.file);
	}

	const [x, y, drawnWidth, drawnHeight] = calculateBBox(positionedWindow, parentInfo);
	return { html, width: x + drawnWidth, height: y + drawnHeight };
}

// Names `file` on every element of rendered .gui markup that carries offsets into it, so a click on
// one opens that file rather than the one the preview shows.
function withNavigatorFile(html: string, file: string): string {
	return html.replace(/(\s)start="/g, `$1file="${htmlEscape(file)}" start="`);
}
