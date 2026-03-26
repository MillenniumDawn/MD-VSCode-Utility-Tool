"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGridBoxConnection = exports.renderLineConnections = exports.renderGridBoxCommon = void 0;
const tslib_1 = require("tslib");
const common_1 = require("./common");
const lodash_1 = require("lodash");
const offsetMap = {
    left: { x: 0, y: 0.5 },
    up: { x: 0.5, y: 0 },
    right: { x: 1, y: 0.5 },
    down: { x: 0.5, y: 1 },
    center: { x: 0.5, y: 0.5 },
};
function getLeftUpPosition(gridX, gridY, format, slotSize, gridSize) {
    var _a;
    if (format === 'down') {
        gridY *= -1;
    }
    else if (format === 'left') {
        const t = gridX;
        gridX = gridY;
        gridY = t;
    }
    else if (format === 'right') {
        const t = gridX;
        gridX = -gridY;
        gridY = t;
    }
    const offset = (_a = offsetMap[format]) !== null && _a !== void 0 ? _a : { x: 0, y: 0 };
    return {
        x: gridX * slotSize.width + offset.x * gridSize.width - offset.x * slotSize.width,
        y: gridY * slotSize.height + offset.y * gridSize.height - offset.y * slotSize.height,
    };
}
function getCenterPosition(gridX, gridY, format, slotSize, gridSize) {
    const position = getLeftUpPosition(gridX, gridY, format, slotSize, gridSize);
    position.x += slotSize.width / 2;
    position.y += slotSize.height / 2;
    return position;
}
function renderGridBoxCommon(gridBox, parentInfo, options, onRenderBackground) {
    var _a, _b, _c, _d, _e, _f, _g;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [x, y, width, height, orientation] = (0, common_1.calculateBBox)(gridBox, parentInfo);
        const format = (_b = (_a = gridBox.format) === null || _a === void 0 ? void 0 : _a._name) !== null && _b !== void 0 ? _b : 'up';
        const size = { width, height };
        const xSlotSize = (_c = (0, common_1.normalizeNumberLike)((0, common_1.getWidth)(gridBox.slotsize), 0)) !== null && _c !== void 0 ? _c : 50;
        const ySlotSize = (_d = (0, common_1.normalizeNumberLike)((0, common_1.getHeight)(gridBox.slotsize), 0)) !== null && _d !== void 0 ? _d : 50;
        const slotSize = { width: xSlotSize, height: ySlotSize };
        const childrenParentInfo = { size: slotSize, orientation };
        const cornerPosition = (_e = options.cornerPosition) !== null && _e !== void 0 ? _e : 1;
        const background = onRenderBackground ? yield onRenderBackground(gridBox.background, { size, orientation }) : '';
        const renderedItems = yield Promise.all(Object.values(options.items).map((item) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const children = options.onRenderItem ? yield options.onRenderItem(item, childrenParentInfo) : '';
            const position = getLeftUpPosition(item.gridX, item.gridY, format, slotSize, size);
            return `<div
            ${item.htmlId ? `id="${item.htmlId}"` : ''}
            class="
                ${item.classNames ? item.classNames : ''}
                ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
                ${options.styleTable.oneTimeStyle('gridbox-item', () => `
                    left: ${position.x}px;
                    top: ${position.y}px;
                    width: ${xSlotSize}px;
                    height: ${ySlotSize}px;
                `)}
            ">
                ${children}
            </div>`;
        })));
        const renderedConnections = options.lineRenderMode !== 'control' ?
            renderLineConnections(options.items, format, slotSize, size, options.styleTable, cornerPosition) :
            yield renderControlConnections(options.items, format, slotSize, size, options.onRenderLineBox, options.styleTable, childrenParentInfo);
        return `<div
    ${options.id ? `id="${options.id}"` : ''}
    start="${(_f = gridBox._token) === null || _f === void 0 ? void 0 : _f.start}"
    end="${(_g = gridBox._token) === null || _g === void 0 ? void 0 : _g.end}"
    class="
        ${(options === null || options === void 0 ? void 0 : options.classNames) ? options.classNames : ''}
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
    });
}
exports.renderGridBoxCommon = renderGridBoxCommon;
function renderLineConnections(items, format, slotSize, size, styleTable, cornerPosition) {
    return Object.values(items).map(item => item.connections.map(conn => {
        var _a;
        const target = items[conn.target];
        if (!target) {
            return '';
        }
        const itemPosition = getCenterPosition(item.gridX, item.gridY, format, slotSize, size);
        const targetPosition = getCenterPosition(target.gridX, target.gridY, format, slotSize, size);
        return renderGridBoxConnection(itemPosition, targetPosition, (_a = conn.style) !== null && _a !== void 0 ? _a : '', conn.targetType, format, slotSize, conn.classNames, styleTable, cornerPosition);
    }).join('')).join('');
}
exports.renderLineConnections = renderLineConnections;
function renderGridBoxConnection(a, b, style, type, format, gridSize, classNames, styleTable, cornerPosition = 1.5) {
    if (a.y === b.y) {
        return `<div
            class="
                ${classNames ? classNames : ''}
                ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                ${styleTable.oneTimeStyle('gridbox-connection', () => `
                    left: ${Math.min(a.x, b.x)}px;
                    top: ${a.y}px;
                    width: ${Math.abs(a.x - b.x)}px;
                    height: ${1}px;
                    border-top: ${style};
                `)}
                ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
            "></div>`;
    }
    if (a.x === b.x) {
        return `<div
            class="
                ${classNames ? classNames : ''}
                ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                ${styleTable.oneTimeStyle('gridbox-connection', () => `
                    left: ${a.x}px;
                    top: ${Math.min(a.y, b.y)}px;
                    width: ${1}px;
                    height: ${Math.abs(a.y - b.y)}px;
                    border-left: ${style};
                `)}
                ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
            "></div>`;
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
            return `<div
                class="
                    ${classNames ? classNames : ''}
                    ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                    ${styleTable.oneTimeStyle('gridbox-connection', () => `
                        left: ${Math.min(a.x, b.x)}px;
                        top: ${Math.min(a.y, b.y)}px;
                        width: ${Math.abs(bx)}px;
                        height: ${Math.abs(by)}px;
                        ${bx < 0 ? 'border-left' : 'border-right'}: ${style};
                        ${by < 0 ? 'border-bottom' : 'border-top'}: ${style};
                    `)}
                    ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                "></div>`;
        }
        else {
            return `<div
                class="
                    ${classNames ? classNames : ''}
                    ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                    ${styleTable.oneTimeStyle('gridbox-connection', () => `
                        left: ${Math.min(a.x, a.x + cornerWidth * Math.sign(bx))}px;
                        top: ${Math.min(a.y, b.y)}px;
                        width: ${cornerWidth}px;
                        height: ${Math.abs(by)}px;
                        ${bx < 0 ? 'border-left' : 'border-right'}: ${style};
                        ${by < 0 ? 'border-bottom' : 'border-top'}: ${style};
                    `)}
                    ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                "></div>
                <div
                class="
                    ${classNames ? classNames : ''}
                    ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                    ${styleTable.oneTimeStyle('gridbox-connection', () => `
                        left: ${Math.min(b.x, a.x + cornerWidth * Math.sign(bx))}px;
                        top: ${Math.min(a.y, b.y)}px;
                        width: ${Math.abs(bx) - cornerWidth}px;
                        height: ${Math.abs(by)}px;
                        ${by > 0 ? 'border-bottom' : 'border-top'}: ${style};
                    `)}
                    ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                "></div>`;
        }
    }
    else {
        const bx = b.x - a.x;
        const by = b.y - a.y;
        const cornerHeight = gridSize.height * cornerPosition;
        if (Math.abs(by) < cornerHeight) {
            return `<div
                class="
                    ${classNames ? classNames : ''}
                    ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                    ${styleTable.oneTimeStyle('gridbox-connection', () => `
                        left: ${Math.min(a.x, b.x)}px;
                        top: ${Math.min(a.y, b.y)}px;
                        width: ${Math.abs(bx)}px;
                        height: ${Math.abs(by)}px;
                        ${bx > 0 ? 'border-left' : 'border-right'}: ${style};
                        ${by > 0 ? 'border-bottom' : 'border-top'}: ${style};
                    `)}
                    ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                "></div>`;
        }
        else {
            return `<div
                class="
                    ${classNames ? classNames : ''}
                    ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                    ${styleTable.oneTimeStyle('gridbox-connection', () => `
                        left: ${Math.min(a.x, b.x)}px;
                        top: ${Math.min(a.y, a.y + cornerHeight * Math.sign(by))}px;
                        width: ${Math.abs(bx)}px;
                        height: ${cornerHeight}px;
                        ${bx > 0 ? 'border-left' : 'border-right'}: ${style};
                        ${by > 0 ? 'border-bottom' : 'border-top'}: ${style};
                    `)}
                    ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                "></div>
                <div
                class="
                    ${classNames ? classNames : ''}
                    ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                    ${styleTable.oneTimeStyle('gridbox-connection', () => `
                        left: ${Math.min(a.x, b.x)}px;
                        top: ${Math.min(b.y, a.y + cornerHeight * Math.sign(by))}px;
                        width: ${Math.abs(bx)}px;
                        height: ${Math.abs(by) - cornerHeight}px;
                        ${bx > 0 ? 'border-right' : 'border-left'}: ${style};
                    `)}
                    ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                "></div>`;
        }
    }
}
exports.renderGridBoxConnection = renderGridBoxConnection;
function renderControlConnections(items, format, slotSize, size, onRenderLineBox, styleTable, childrenParentInfo) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const controlMatrix = {};
        const xSlotSize = slotSize.width;
        const ySlotSize = slotSize.height;
        for (const item of Object.values(items)) {
            for (const conn of item.connections) {
                const target = items[conn.target];
                if (target !== undefined) {
                    if (conn.targetType !== 'parent') {
                        drawLineOnControlMatrix(item, target, controlMatrix, format);
                    }
                    else {
                        drawLineOnControlMatrix(target, item, controlMatrix, format);
                    }
                }
            }
        }
        return (yield Promise.all((0, lodash_1.flatMap)(controlMatrix, m => (0, lodash_1.map)(m, (item) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const children = onRenderLineBox ? yield onRenderLineBox(item, childrenParentInfo) : '';
            const position = getLeftUpPosition(item.x, item.y, format, slotSize, size);
            return `<div
                    class="
                        ${styleTable.style('positionAbsolute', () => `position: absolute;`)}
                        ${styleTable.oneTimeStyle('gridbox-connection', () => `
                            left: ${position.x}px;
                            top: ${position.y}px;
                            width: ${xSlotSize}px;
                            height: ${ySlotSize}px;
                        `)}
                        ${styleTable.style('pointerEventsNone', () => `pointer-events: none;`)}
                    ">
                        ${children}
                    </div>`;
        }))))).join('');
    });
}
function drawLineOnControlMatrix(s, t, controlMatrix, format) {
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
    }
    else {
        vLineOnControlMatrix(s.gridX, s.gridY, s.gridY + sign, s.id, t.id, controlMatrix, format);
        hLineOnControlMatrix(s.gridY + sign, s.gridX, t.gridX, s.id, t.id, controlMatrix, format);
        if (t.gridY !== s.gridY + sign) {
            vLineOnControlMatrix(t.gridX, s.gridY + sign, t.gridY, s.id, t.id, controlMatrix, format);
        }
    }
}
function hLineOnControlMatrix(y, start, end, sId, eId, controlMatrix, format, containStart = true, containEnd = true) {
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
function vLineOnControlMatrix(x, start, end, sId, eId, controlMatrix, format, containStart = true, containEnd = true) {
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
function drawSemiLineOnControlMatrix(controlMatrix, x, y, format, direction, inId, outId) {
    if (format === 'down') {
        direction = direction === 'up' ? 'down' : direction === 'down' ? 'up' : direction;
    }
    else if (format === 'left') {
        direction = direction === 'up' ? 'left' : direction === 'down' ? 'right' : direction === 'left' ? 'up' : 'down';
    }
    else if (format === 'right') {
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
//# sourceMappingURL=gridboxcommon.js.map