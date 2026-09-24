import { HOIPartial, NumberLike, toNumberLike, toStringAsSymbolIgnoreCase } from '../../hoiformat/schema';
import { ContainerWindowType, GridBoxType, GuiFile, PositionType } from '../../hoiformat/gui';
import { NumberPosition } from '../../util/common';
import { normalizeNumberLike } from '../../util/hoi4gui/common';
import { defaultExclusiveLinkSprites, ExclusiveLinkSpriteSpec } from '../../util/hoi4gui/exclusivelink';

export type FocusTreeLayoutMode = 'standard' | 'gui';

export const nationalFocusViewGuiFile = 'interface/nationalfocusview.gui';

/**
 * Where the layers of one focus sit inside its grid slot, in the numbers the focus renderer writes
 * into its CSS. The standard values are the ones the preview has always used.
 */
export interface FocusItemLayout {
    iconOffsetX: number;
    iconOffsetY: number;
    titlebarOffsetX: number;
    titlebarTop: number;
    overlayOffsetX: number;
    overlayOffsetY: number;
    textOffsetX: number;
    textTop: number;
}

// The way the tree grows from its first row, which the game takes from the grid's `format`.
export type FocusTreeFormat = 'up' | 'down' | 'left' | 'right';

export interface FocusTreeLayout {
    mode: FocusTreeLayoutMode;
    format: FocusTreeFormat;
    grid: NumberPosition;
    spacing: NumberPosition;
    item: FocusItemLayout;
    // Undefined when both ends are where the standard layout puts them, so a standard page carries
    // nothing extra.
    links?: { parent: NumberPosition; child: NumberPosition };
    exclusive: { offsetY: number; sprites: ExclusiveLinkSpriteSpec };
}

export const standardFocusTreeLayout: FocusTreeLayout = {
    mode: 'standard',
    format: 'up',
    grid: { x: 50, y: 50 },
    spacing: { x: 96, y: 130 },
    item: {
        iconOffsetX: 0,
        iconOffsetY: -18,
        titlebarOffsetX: 0,
        titlebarTop: 70,
        overlayOffsetX: 0,
        overlayOffsetY: -3,
        textOffsetX: 0,
        textTop: 85,
    },
    exclusive: { offsetY: 0, sprites: defaultExclusiveLinkSprites },
};

// What the game's own nationalfocusview.gui declares, which the standard layout was drawn to match.
// The preview's focus is a 96x130 slot, not the game's 165x128 window, so a mod's gui coordinates
// cannot be used as they are: each one moves the standard layout by how far it is from these.
const reference = {
    symbol: { x: 5, y: -44 },
    bg: { x: 5, y: 40 },
    overlay: { x: -9, y: -28 },
    name: { x: 15, y: 58, maxWidth: 147 },
    linkBegin: { x: 80, y: 64 },
    linkEnd: { x: 80, y: 0 },
    exclusiveOffsetY: 24,
    exclusiveItemY: 28,
};

type Window = HOIPartial<ContainerWindowType>;

function num(value: NumberLike | undefined): number | undefined {
    return normalizeNumberLike(value, 0);
}

function point(position: HOIPartial<{ x: NumberLike; y: NumberLike }> | undefined): Partial<NumberPosition> {
    return { x: num(position?.x), y: num(position?.y) };
}

function findWindow(windows: Window[], name: string): Window | undefined {
    for (const window of windows) {
        if (window.name === name) {
            return window;
        }
    }
    for (const window of windows) {
        const found = findWindow([...window.containerwindowtype, ...window.windowtype], name);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function childWindow(window: Window | undefined, name: string): Window | undefined {
    return window ? [...window.containerwindowtype, ...window.windowtype].find(w => w.name === name) : undefined;
}

function byName<T extends { name?: string }>(elements: T[] | undefined, name: string): T | undefined {
    return elements?.find(e => e.name === name);
}

function shift(standard: number, value: number | undefined, referenceValue: number): number {
    return value === undefined ? standard : standard + value - referenceValue;
}

// The gui counts frames from 1 and an icon without one shows the first; a missing icon keeps the default.
function frameOf(icon: { frame?: number } | undefined, fallback: number): number {
    return icon === undefined ? fallback : Math.max(0, (icon.frame ?? 1) - 1);
}

/**
 * Builds the focus tree layout from the loaded nationalfocusview.gui. Every value the file does not
 * declare keeps the standard one, so an empty list gives the standard layout in gui mode.
 */
export function buildFocusTreeLayout(guiFiles: HOIPartial<GuiFile>[]): FocusTreeLayout {
    const guiTypes = guiFiles.flatMap(f => f.guitypes);
    const windows = guiTypes.flatMap(t => [...t.containerwindowtype, ...t.windowtype]);
    const positions: Record<string, Partial<NumberPosition>> = {};
    const collectPositions = (list: HOIPartial<PositionType>[]) => {
        for (const position of list) {
            if (position.name && !(position.name in positions)) {
                positions[position.name] = point(position.position);
            }
        }
    };
    guiTypes.forEach(t => collectPositions(t.positiontype));

    const standard = standardFocusTreeLayout;

    // The focus grid is `grid` inside `tree > grid_window`; the game's file has a second gridbox of
    // that name elsewhere, so the path is walked rather than the name looked up.
    const view = findWindow(windows, 'nationalfocusview');
    const gridBox = byName(childWindow(childWindow(view, 'tree'), 'grid_window')?.gridboxtype, 'grid');
    const gridPosition = point(gridBox?.position);
    const format = gridBox?.format?._name;

    const spacing = positions['focus_spacing'] ?? {};

    const item = findWindow(windows, 'national_focus_item');
    const symbol = point(byName(item?.buttontype, 'symbol')?.position);
    const bg = point(byName(item?.buttontype, 'bg')?.position);
    const overlay = point(byName(item?.icontype, 'overlay')?.position);
    const nameBox = byName(item?.instanttextboxtype, 'name');
    const name = point(nameBox?.position);
    const nameMaxWidth = num(nameBox?.maxwidth) ?? reference.name.maxWidth;
    const nameCenter = name.x === undefined && nameBox?.maxwidth === undefined ? undefined : (name.x ?? reference.name.x) + nameMaxWidth / 2;

    const linkBegin = positions['link_begin'] ?? {};
    const linkEnd = positions['link_end'] ?? {};
    const parent = {
        x: shift(0, linkBegin.x, reference.linkBegin.x),
        y: shift(0, linkBegin.y, reference.linkBegin.y),
    };
    const child = {
        x: shift(0, linkEnd.x, reference.linkEnd.x),
        y: shift(0, linkEnd.y, reference.linkEnd.y),
    };
    const links = parent.x === 0 && parent.y === 0 && child.x === 0 && child.y === 0 ? undefined : { parent, child };

    const exclusiveItem = findWindow(windows, 'national_focus_exclusive_item');
    const exclusiveOffsetY = shift(0, positions['exclusive_offset']?.y, reference.exclusiveOffsetY) +
        shift(0, num(exclusiveItem?.position?.y), reference.exclusiveItemY);
    const exclusiveIcon = (iconName: string) => byName(exclusiveItem?.icontype, iconName);
    const line = exclusiveIcon('link1');
    const left = exclusiveIcon('left');
    const mid = exclusiveIcon('mid');
    const right = exclusiveIcon('right');
    const defaults = defaultExclusiveLinkSprites;

    return {
        mode: 'gui',
        // `center` would stack every focus on one slot; the game's own file says `UP`.
        format: format === 'down' || format === 'left' || format === 'right' ? format : 'up',
        grid: { x: gridPosition.x ?? standard.grid.x, y: gridPosition.y ?? standard.grid.y },
        spacing: { x: spacing.x ?? standard.spacing.x, y: spacing.y ?? standard.spacing.y },
        item: {
            iconOffsetX: shift(standard.item.iconOffsetX, symbol.x, reference.symbol.x),
            iconOffsetY: shift(standard.item.iconOffsetY, symbol.y, reference.symbol.y),
            titlebarOffsetX: shift(standard.item.titlebarOffsetX, bg.x, reference.bg.x),
            titlebarTop: shift(standard.item.titlebarTop, bg.y, reference.bg.y),
            overlayOffsetX: shift(standard.item.overlayOffsetX, overlay.x, reference.overlay.x),
            overlayOffsetY: shift(standard.item.overlayOffsetY, overlay.y, reference.overlay.y),
            textOffsetX: shift(standard.item.textOffsetX, nameCenter, reference.name.x + reference.name.maxWidth / 2),
            textTop: shift(standard.item.textTop, name.y, reference.name.y),
        },
        ...(links ? { links } : {}),
        exclusive: {
            offsetY: exclusiveOffsetY,
            sprites: {
                lineGfx: line?.spritetype ?? line?.quadtexturesprite ?? defaults.lineGfx,
                lineFrame: frameOf(line, defaults.lineFrame),
                leftGfx: left?.spritetype ?? left?.quadtexturesprite ?? defaults.leftGfx,
                leftFrame: frameOf(left, defaults.leftFrame),
                midGfx: mid?.spritetype ?? mid?.quadtexturesprite ?? defaults.midGfx,
                midFrame: frameOf(mid, defaults.midFrame),
                rightGfx: right?.spritetype ?? right?.quadtexturesprite ?? defaults.rightGfx,
                rightFrame: frameOf(right, defaults.rightFrame),
            },
        },
    };
}

export function focusTreeGridBoxFor(layout: FocusTreeLayout): HOIPartial<GridBoxType> {
    return {
        position: { x: toNumberLike(layout.grid.x), y: toNumberLike(layout.grid.y) },
        format: toStringAsSymbolIgnoreCase(layout.format),
        size: { width: toNumberLike(layout.spacing.x), height: undefined },
        slotsize: { width: toNumberLike(layout.spacing.x), height: toNumberLike(layout.spacing.y) },
    } as HOIPartial<GridBoxType>;
}
