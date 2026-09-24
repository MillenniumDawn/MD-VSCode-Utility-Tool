import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo, calculateBBox, normalizeNumberLike, RenderCommonOptions, getWidth, getHeight } from "./common";
import { NumberSize, NumberPosition } from "../common";
import { StyleTable, normalizeForStyle } from '../styletable';
import { escapeAttr } from '../escape';
import { GridBoxType, Format, Background } from "../../hoiformat/gui";
import map from "lodash/map";
import flatMap from "lodash/flatMap";

export type GridBoxConnectionType = 'child' | 'parent' | 'related';

export interface GridBoxConnection {
    target: string;
    targetType: GridBoxConnectionType;
    style?: string;
    classNames?: string;
    // Picks the dashed tiles when the connection is drawn with `connectionTiles`.
    dashed?: boolean;
}

export interface GridBoxItem {
    id: string;
    gridX: number;
    gridY: number;
    connections: GridBoxConnection[];
    isJoint?: boolean;
    htmlId?: string;
    classNames?: string;
}

export interface GridBoxConnectionItemDirection {
    in: Record<string, true>;
    out: Record<string, true>;
}

export interface GridBoxConnectionItem {
    x: number;
    y: number;
    up?: GridBoxConnectionItemDirection;
    down?: GridBoxConnectionItemDirection;
    left?: GridBoxConnectionItemDirection;
    right?: GridBoxConnectionItemDirection;
}

export interface RenderGridBoxCommonOptions extends RenderCommonOptions {
    items: Record<string, GridBoxItem>;
    onRenderItem?(item: GridBoxItem, parentInfo: ParentInfo): Promise<string>;
    onRenderLineBox?(item: GridBoxConnectionItem, parentInfo: ParentInfo): Promise<string>;
    lineRenderMode?: 'line' | 'control';
    cornerPosition?: number;
    // Moves the end of a 'parent' connection away from the slot centres: `child` at the item that
    // declares the connection, `parent` at its target. Line render mode only.
    connectionOffsets?: GridBoxConnectionOffsets;
    // Draws 'parent' connections as square tiles along the same path instead of borders, the way
    // the game lays out its link sprites. Line render mode only.
    connectionTiles?: GridBoxConnectionTiles;
}

export interface GridBoxConnectionOffsets {
    parent: NumberPosition;
    child: NumberPosition;
}

// A straight run along one axis, or a corner named by the two directions it connects.
export type GridBoxTileShape = 'up_down' | 'left_right' | 'up_left' | 'up_right' | 'down_left' | 'down_right';

export interface GridBoxConnectionTiles {
    // Edge of one square tile, centred on the line.
    size: number;
    // Moves every tile, for a gui that places them off the line.
    offset?: NumberPosition;
    className(shape: GridBoxTileShape, dashed: boolean): string;
}

const offsetMap: Record<Format['_name'], { x: number, y: number }> = {
    left: { x: 0, y: 0.5 },
    up: { x: 0.5, y: 0 },
    right: { x: 1, y: 0.5 },
    down: { x: 0.5, y: 1 },
    center: { x: 0.5, y: 0.5 },
};

function getLeftUpPosition(gridX: number, gridY: number, format: Format['_name'], slotSize: NumberSize, gridSize: NumberSize): NumberPosition {
    if (format === 'down') {
        gridY *= -1;
    } else if (format === 'left') {
        const t = gridX;
        gridX = gridY;
        gridY = t;
    } else if (format === 'right') {
        const t = gridX;
        gridX = -gridY;
        gridY = t;
    }

    const offset = offsetMap[format] ?? { x: 0, y: 0 };
    return {
        x: gridX * slotSize.width + offset.x * gridSize.width - offset.x * slotSize.width,
        y: gridY * slotSize.height + offset.y * gridSize.height - offset.y * slotSize.height,
    };
}

function getCenterPosition(gridX: number, gridY: number, format: Format['_name'], slotSize: NumberSize, gridSize: NumberSize): NumberPosition {
    const position = getLeftUpPosition(gridX, gridY, format, slotSize, gridSize);
    position.x += slotSize.width / 2;
    position.y += slotSize.height / 2;
    return position;
}

export async function renderGridBoxCommon(
    gridBox: HOIPartial<GridBoxType>,
    parentInfo: ParentInfo,
    options: RenderGridBoxCommonOptions,
    onRenderBackground?: (background: HOIPartial<Background> | undefined, parentInfo: ParentInfo) => Promise<string>
): Promise<string> {
    const [x, y, width, height, orientation] = calculateBBox(gridBox, parentInfo);
    const format = gridBox.format?._name ?? 'up';

    const size = { width, height };
    const xSlotSize = normalizeNumberLike(getWidth(gridBox.slotsize), 0) ?? 50;
    const ySlotSize = normalizeNumberLike(getHeight(gridBox.slotsize), 0) ?? 50;
    const slotSize = { width: xSlotSize, height: ySlotSize };
    const childrenParentInfo: ParentInfo = { size: slotSize, orientation };
    const cornerPosition = options.cornerPosition ?? 1;

    const background = onRenderBackground ? await onRenderBackground(gridBox.background, { size, orientation }) : '';

    const renderedItems = await Promise.all(Object.values(options.items).map(async (item) => {
        const children = options.onRenderItem ? await options.onRenderItem(item, childrenParentInfo) : '';
        const position = getLeftUpPosition(item.gridX, item.gridY, format, slotSize, size);
        return `<div
            data-gridbox-item="${escapeAttr(item.id)}" data-gridbox-x="${item.gridX}" data-gridbox-y="${item.gridY}"
            ${item.htmlId ? `id="${escapeAttr(item.htmlId)}"` : ''}
            class="
                ${item.classNames ? item.classNames : ''}
                ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
            "
            style="${boxStyle(position.x, position.y, xSlotSize, ySlotSize)}">
                ${children}
            </div>`;
    }));

    const renderedConnections = options.lineRenderMode !== 'control' ?
        renderLineConnections(options.items, format, slotSize, size, options.styleTable, cornerPosition, options.connectionOffsets, options.connectionTiles) :
        await renderControlConnections(options.items, format, slotSize, size, options.onRenderLineBox, options.styleTable, childrenParentInfo);

    return `<div
    ${options.id ? `id="${escapeAttr(options.id)}"` : ''}
    start="${gridBox._token?.start}"
    end="${gridBox._token?.end}"
    class="
        ${options?.classNames ? options.classNames : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('gridbox', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${width}px;
            height: ${height}px;
        `)}
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
    ">
        ${background}
        ${renderedConnections}
        ${renderedItems.join('')}
    </div>`;
}

export function renderLineConnections(items: Record<string, GridBoxItem>, format: Format['_name'], slotSize: NumberSize, size: NumberSize, styleTable: StyleTable, cornerPosition: number, connectionOffsets?: GridBoxConnectionOffsets, connectionTiles?: GridBoxConnectionTiles): string {
    return Object.values(items).map(item =>
        item.connections.map(conn => {
            const target = items[conn.target];
            if (!target) {
                return '';
            }

            const itemPosition = getCenterPosition(item.gridX, item.gridY, format, slotSize, size);
            const targetPosition = getCenterPosition(target.gridX, target.gridY, format, slotSize, size);
            if (connectionOffsets && conn.targetType === 'parent') {
                itemPosition.x += connectionOffsets.child.x;
                itemPosition.y += connectionOffsets.child.y;
                targetPosition.x += connectionOffsets.parent.x;
                targetPosition.y += connectionOffsets.parent.y;
            }
            if (connectionTiles && conn.targetType === 'parent') {
                return renderTiledConnection(
                    connectionPath(itemPosition, targetPosition, conn.targetType, format, slotSize, cornerPosition),
                    connectionTiles, conn.dashed ?? false, conn.style ?? '', conn.targetType, conn.classNames, styleTable, item.id, conn.target,
                );
            }
            return renderGridBoxConnection(itemPosition, targetPosition, conn.style ?? '', conn.targetType, format, slotSize, conn.classNames, styleTable, cornerPosition, item.id, conn.target);
        }).join('')
    ).join('');
}

// Geometry that is unique to one element goes in its style attribute: a class used exactly once costs
// a rule to parse and match and buys nothing, and a tech tree has ten thousand of them.
function boxStyle(left: number, top: number, width: number, height: number): string {
    return `left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px;`;
}

function renderConnectionBox(
    diag: string,
    classNames: string | undefined,
    styleTable: StyleTable,
    left: number,
    top: number,
    width: number,
    height: number,
    border: string,
): string {
    // The border stays a class, shared by every line drawn the same way: the focus tree recolours a
    // traced line through a selector on the connection, which an inline border would beat.
    return `<div${diag}
        class="
            ${classNames ? classNames : ''}
            ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
            ${styleTable.style('gridbox-connection-' + normalizeForStyle(border), () => border)}
            ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
        "
        style="${boxStyle(left, top, width, height)}"></div>`;
}

export function renderGridBoxConnection(a: NumberPosition, b: NumberPosition, style: string, type: GridBoxConnectionType, format: Format['_name'], gridSize: NumberSize, classNames: string | undefined, styleTable: StyleTable, cornerPosition: number = 1.5, fromId: string = '', toId: string = ''): string {
    const diag = ` data-conn-from="${escapeAttr(fromId)}" data-conn-to="${escapeAttr(toId)}" data-conn-type="${type}" data-conn-style="${style.replace(/"/g, '&quot;')}"`;
    if (a.y === b.y) {
        return renderConnectionBox(
            diag, classNames, styleTable,
            Math.min(a.x, b.x), a.y, Math.abs(a.x - b.x), 1,
            `border-top: ${style};`,
        );
    }
    if (a.x === b.x) {
        return renderConnectionBox(
            diag, classNames, styleTable,
            a.x, Math.min(a.y, b.y), 1, Math.abs(a.y - b.y),
            `border-left: ${style};`,
        );
    }

    if (type === 'parent') {
        const c = a;
        a = b;
        b = c;
        type = 'child';
    }

    if (format === 'left' || format === 'right') {
        const bx = b.x - a.x;
        const by = b.y - a.y;
        const cornerWidth = gridSize.width * cornerPosition;
        if (Math.abs(bx) < cornerWidth) {
            return renderConnectionBox(
                diag, classNames, styleTable,
                Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(bx), Math.abs(by),
                `${bx < 0 ? 'border-left' : 'border-right'}: ${style}; ${by < 0 ? 'border-bottom' : 'border-top'}: ${style};`,
            );
        } else {
            return renderConnectionBox(
                diag, classNames, styleTable,
                Math.min(a.x, a.x + cornerWidth * Math.sign(bx)), Math.min(a.y, b.y), cornerWidth, Math.abs(by),
                `${bx < 0 ? 'border-left' : 'border-right'}: ${style}; ${by < 0 ? 'border-bottom' : 'border-top'}: ${style};`,
            ) + renderConnectionBox(
                diag, classNames, styleTable,
                Math.min(b.x, a.x + cornerWidth * Math.sign(bx)), Math.min(a.y, b.y), Math.abs(bx) - cornerWidth, Math.abs(by),
                `${by > 0 ? 'border-bottom' : 'border-top'}: ${style};`,
            );
        }
    } else {
        const bx = b.x - a.x;
        const by = b.y - a.y;
        const cornerHeight = gridSize.height * cornerPosition;
        if (Math.abs(by) < cornerHeight) {
            return renderConnectionBox(
                diag, classNames, styleTable,
                Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(bx), Math.abs(by),
                `${bx > 0 ? 'border-left' : 'border-right'}: ${style}; ${by > 0 ? 'border-bottom' : 'border-top'}: ${style};`,
            );
        } else {
            return renderConnectionBox(
                diag, classNames, styleTable,
                Math.min(a.x, b.x), Math.min(a.y, a.y + cornerHeight * Math.sign(by)), Math.abs(bx), cornerHeight,
                `${bx > 0 ? 'border-left' : 'border-right'}: ${style}; ${by > 0 ? 'border-bottom' : 'border-top'}: ${style};`,
            ) + renderConnectionBox(
                diag, classNames, styleTable,
                Math.min(a.x, b.x), Math.min(b.y, a.y + cornerHeight * Math.sign(by)), Math.abs(bx), Math.abs(by) - cornerHeight,
                `${bx > 0 ? 'border-right' : 'border-left'}: ${style};`,
            );
        }
    }
}

/**
 * The points the border drawing of `renderGridBoxConnection` passes through, from `a` to `b` with
 * the ends of a 'parent' connection swapped the same way, so a tiled line takes the same path.
 */
export function connectionPath(a: NumberPosition, b: NumberPosition, type: GridBoxConnectionType, format: Format['_name'], gridSize: NumberSize, cornerPosition: number = 1.5): NumberPosition[] {
    if (a.y === b.y || a.x === b.x) {
        return [a, b];
    }

    if (type === 'parent') {
        const c = a;
        a = b;
        b = c;
    }

    const bx = b.x - a.x;
    const by = b.y - a.y;
    if (format === 'left' || format === 'right') {
        const cornerWidth = gridSize.width * cornerPosition;
        if (Math.abs(bx) < cornerWidth) {
            return [a, { x: b.x, y: a.y }, b];
        }
        const x = a.x + cornerWidth * Math.sign(bx);
        return [a, { x, y: a.y }, { x, y: b.y }, b];
    }

    const cornerHeight = gridSize.height * cornerPosition;
    if (Math.abs(by) < cornerHeight) {
        return [a, { x: a.x, y: b.y }, b];
    }
    const y = a.y + cornerHeight * Math.sign(by);
    return [a, { x: a.x, y }, { x: b.x, y }, b];
}

// Drops repeated points and the middle of three points on one line, so every inner point left is a turn.
function turningPoints(points: NumberPosition[]): NumberPosition[] {
    const result: NumberPosition[] = [];
    for (const point of points) {
        const last = result[result.length - 1];
        if (last && last.x === point.x && last.y === point.y) {
            continue;
        }
        const beforeLast = result[result.length - 2];
        if (last && beforeLast && ((beforeLast.x === last.x && last.x === point.x) || (beforeLast.y === last.y && last.y === point.y))) {
            result.pop();
        }
        result.push(point);
    }
    return result;
}

// Every pair of neighbouring points, and every point with both of its neighbours.
function segmentsOf(points: NumberPosition[]): [NumberPosition, NumberPosition][] {
    return points.slice(1).map((q, i) => [points[i] as NumberPosition, q]);
}

function turnsOf(points: NumberPosition[]): [NumberPosition, NumberPosition, NumberPosition][] {
    return points.slice(1, -1).map((p, i) => [points[i] as NumberPosition, p, points[i + 2] as NumberPosition]);
}

function directionTo(from: NumberPosition, to: NumberPosition): 'up' | 'down' | 'left' | 'right' {
    if (to.x === from.x) {
        return to.y < from.y ? 'up' : 'down';
    }
    return to.x < from.x ? 'left' : 'right';
}

function cornerShape(prev: NumberPosition, point: NumberPosition, next: NumberPosition): GridBoxTileShape {
    const directions = [directionTo(point, prev), directionTo(point, next)];
    const vertical = directions.find(d => d === 'up' || d === 'down');
    const horizontal = directions.find(d => d === 'left' || d === 'right');
    return `${vertical}_${horizontal}` as GridBoxTileShape;
}

function renderTileBox(diag: string, classNames: string | undefined, styleTable: StyleTable, left: number, top: number, width: number, height: number, tileClass: string): string {
    return `<div${diag}
        class="
            ${classNames ? classNames : ''}
            ${tileClass}
            ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
            ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
        "
        style="${boxStyle(left, top, width, height)}"></div>`;
}

/**
 * One tile at every turn of the path and one run of tiles along every straight stretch between
 * them, each run stopping half a tile short of a turn so the corner tile is not drawn over.
 */
function renderTiledConnection(
    path: NumberPosition[],
    tiles: GridBoxConnectionTiles,
    dashed: boolean,
    style: string,
    type: GridBoxConnectionType,
    classNames: string | undefined,
    styleTable: StyleTable,
    fromId: string,
    toId: string,
): string {
    const diag = ` data-conn-from="${escapeAttr(fromId)}" data-conn-to="${escapeAttr(toId)}" data-conn-type="${type}" data-conn-style="${style.replace(/"/g, '&quot;')}"`;
    const points = turningPoints(path);
    const size = tiles.size;
    const half = size / 2;
    const offsetX = tiles.offset?.x ?? 0;
    const offsetY = tiles.offset?.y ?? 0;
    let result = '';

    const segments = segmentsOf(points);
    segments.forEach(([p, q], i) => {
        const startTrim = i > 0 ? half : 0;
        const endTrim = i < segments.length - 1 ? half : 0;
        if (p.y === q.y) {
            const sign = Math.sign(q.x - p.x);
            const from = p.x + sign * startTrim;
            const to = q.x - sign * endTrim;
            if ((to - from) * sign > 0) {
                result += renderTileBox(diag, classNames, styleTable,
                    Math.min(from, to) + offsetX, p.y - half + offsetY, Math.abs(to - from), size,
                    tiles.className('left_right', dashed));
            }
        } else {
            const sign = Math.sign(q.y - p.y);
            const from = p.y + sign * startTrim;
            const to = q.y - sign * endTrim;
            if ((to - from) * sign > 0) {
                result += renderTileBox(diag, classNames, styleTable,
                    p.x - half + offsetX, Math.min(from, to) + offsetY, size, Math.abs(to - from),
                    tiles.className('up_down', dashed));
            }
        }
    });

    for (const [prev, point, next] of turnsOf(points)) {
        result += renderTileBox(diag, classNames, styleTable,
            point.x - half + offsetX, point.y - half + offsetY, size, size,
            tiles.className(cornerShape(prev, point, next), dashed));
    }

    return result;
}

type ControlMatrix = Record<number, Record<number, GridBoxConnectionItem>>;
async function renderControlConnections(
    items: Record<string, GridBoxItem>,
    format: Format['_name'],
    slotSize: NumberSize,
    size: NumberSize,
    onRenderLineBox: RenderGridBoxCommonOptions['onRenderLineBox'],
    styleTable: StyleTable,
    childrenParentInfo: ParentInfo
): Promise<string> {
    const controlMatrix: ControlMatrix = {};
    const xSlotSize = slotSize.width;
    const ySlotSize = slotSize.height;

    for (const item of Object.values(items)) {
        for (const conn of item.connections) {
            const target = items[conn.target];
            if (target !== undefined) {
                if (conn.targetType !== 'parent') {
                    drawLineOnControlMatrix(item, target, controlMatrix, format);
                } else {
                    drawLineOnControlMatrix(target, item, controlMatrix, format);
                }
            }
        }
    }

    return (await Promise.all(
        flatMap(controlMatrix, m =>
            map(m, async (item) => {
                const children = onRenderLineBox ? await onRenderLineBox(item, childrenParentInfo) : '';
                const position = getLeftUpPosition(item.x, item.y, format, slotSize, size);
                const dirSummary = (['up', 'down', 'left', 'right'] as const)
                    .filter(d => item[d])
                    .map(d => `${d}[in:${Object.keys(item[d]!.in).join(',')}|out:${Object.keys(item[d]!.out).join(',')}]`)
                    .join(';');
                const diag = ` data-cell-x="${item.x}" data-cell-y="${item.y}" data-cell-dirs="${dirSummary.replace(/"/g, '&quot;')}"`;
                return `<div${diag}
                    class="
                        ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                        ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                    "
                    style="${boxStyle(position.x, position.y, xSlotSize, ySlotSize)}">
                        ${children}
                    </div>`;
            })
        )
    )).join('');
}

function drawLineOnControlMatrix(s: GridBoxItem, t: GridBoxItem, controlMatrix: ControlMatrix, format: Format['_name']): void {
    if (s.gridY === t.gridY) {
        hLineOnControlMatrix(s.gridY, s.gridX, t.gridX, s.id, t.id, controlMatrix, format);
        return;
    }

    if (s.gridX === t.gridX) {
        vLineOnControlMatrix(s.gridX, s.gridY, t.gridY, s.id, t.id, controlMatrix, format);
        return;
    }

    const sign = Math.sign(t.gridY - s.gridY);
    if (s.isJoint) {
        hLineOnControlMatrix(s.gridY, s.gridX, t.gridX, s.id, t.id, controlMatrix, format);
        vLineOnControlMatrix(t.gridX, s.gridY, t.gridY, s.id, t.id, controlMatrix, format);
    } else {
        vLineOnControlMatrix(s.gridX, s.gridY, s.gridY + sign, s.id, t.id, controlMatrix, format);
        hLineOnControlMatrix(s.gridY + sign, s.gridX, t.gridX, s.id, t.id, controlMatrix, format);
        if (t.gridY !== s.gridY + sign) {
            vLineOnControlMatrix(t.gridX, s.gridY + sign, t.gridY, s.id, t.id, controlMatrix, format);
        }
    }
}

function hLineOnControlMatrix(y: number, start: number, end: number, sId: string, eId: string, controlMatrix: ControlMatrix, format: Format['_name'], containStart: boolean = true, containEnd: boolean = true): void {
    if (start === end) {
        return;
    }
    start = Math.round(start);
    end = Math.round(end);
    const step = Math.sign(end - start);
    const inDirection = step > 0 ? 'left' : 'right';
    const outDirection = step < 0 ? 'left' : 'right';
    if (containStart) {
        drawSemiLineOnControlMatrix(controlMatrix, start, y, format, outDirection, undefined, eId);
    }
    for (let i = start + step; i !== end; i += step) {
        drawSemiLineOnControlMatrix(controlMatrix, i, y, format, inDirection, sId, undefined);
        drawSemiLineOnControlMatrix(controlMatrix, i, y, format, outDirection, undefined, eId);
    }
    if (containEnd) {
        drawSemiLineOnControlMatrix(controlMatrix, end, y, format, inDirection, sId, undefined);
    }
}

function vLineOnControlMatrix(x: number, start: number, end: number, sId: string, eId: string, controlMatrix: ControlMatrix, format: Format['_name'], containStart: boolean = true, containEnd: boolean = true): void {
    if (start === end) {
        return;
    }
    start = Math.round(start);
    end = Math.round(end);
    const step = Math.sign(end - start);
    const inDirection = step > 0 ? 'up' : 'down';
    const outDirection = step < 0 ? 'up' : 'down';
    if (containStart) {
        drawSemiLineOnControlMatrix(controlMatrix, x, start, format, outDirection, undefined, eId);
    }
    for (let i = start + step; i !== end; i += step) {
        drawSemiLineOnControlMatrix(controlMatrix, x, i, format, inDirection, sId, undefined);
        drawSemiLineOnControlMatrix(controlMatrix, x, i, format, outDirection, undefined, eId);
    }
    if (containEnd) {
        drawSemiLineOnControlMatrix(controlMatrix, x, end, format, inDirection, sId, undefined);
    }
}

function drawSemiLineOnControlMatrix(controlMatrix: ControlMatrix, x: number, y: number, format: Format['_name'], direction: Exclude<Format['_name'], 'center'>, inId: string | undefined, outId: string | undefined): void {
    if (format === 'down') {
        direction = direction === 'up' ? 'down' : direction === 'down' ? 'up' : direction;
    } else if (format === 'left') {
        direction = direction === 'up' ? 'left' : direction === 'down' ? 'right' : direction === 'left' ? 'up' : 'down';
    } else if (format === 'right') {
        direction = direction === 'up' ? 'right' : direction === 'down' ? 'left' : direction === 'left' ? 'up' : 'down';
    }

    let xSet = controlMatrix[x];
    if (xSet === undefined) {
        controlMatrix[x] = xSet = {};
    }

    let item = xSet[y];
    if (item === undefined) {
        xSet[y] = item = { x, y };
    }

    let directionFolder = item[direction];
    if (directionFolder === undefined) {
        item[direction] = directionFolder = { in: {}, out: {} };
    }

    if (inId) {
        directionFolder.in[inId] = true;
    }

    if (outId) {
        directionFolder.out[outId] = true;
    }
}
