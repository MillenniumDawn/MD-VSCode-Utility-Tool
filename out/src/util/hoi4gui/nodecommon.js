"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBackground = exports.renderCorneredTileSprite = exports.renderSprite = void 0;
const tslib_1 = require("tslib");
const schema_1 = require("../../hoiformat/schema");
const sprite_1 = require("../image/sprite");
const common_1 = require("./common");
function renderSprite(position, size, sprite, frame, scale, options) {
    if (sprite instanceof sprite_1.CorneredTileSprite) {
        return renderCorneredTileSprite(position, size, sprite, frame, options);
    }
    // Use first frame if frame is not found
    if (!sprite.frames[frame] && frame > 0) {
        frame = 0;
    }
    return `<div
    ${(options === null || options === void 0 ? void 0 : options.id) ? `id="${options.id}"` : ''}
    class="
        ${(options === null || options === void 0 ? void 0 : options.classNames) ? options.classNames : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('sprite', () => `
            left: ${position.x}px;
            top: ${position.y}px;
            width: ${sprite.width * scale}px;
            height: ${sprite.height * scale}px;
        `)}
        ${options.styleTable.style(`sprite-img-${sprite.id}-${frame}`, () => {
        var _a;
        return `
            background-image: url(${(_a = sprite.frames[frame]) === null || _a === void 0 ? void 0 : _a.uri});
            background-size: ${sprite.width * scale}px ${sprite.height * scale}px;
        `;
    })}
    "></div>`;
}
exports.renderSprite = renderSprite;
function renderCorneredTileSprite(position, size, sprite, frame, options) {
    const sizeX = size.width;
    const sizeY = size.height;
    let borderX = sprite.borderSize.x;
    let borderY = sprite.borderSize.y;
    const xPos = borderX * 2 > sizeX ? [0, sizeX / 2, sizeX / 2, sizeX] : [0, borderX, sizeX - borderX, sizeX];
    const yPos = borderY * 2 > sizeY ? [0, sizeY / 2, sizeY / 2, sizeY] : [0, borderY, sizeY - borderY, sizeY];
    const divs = [];
    const tiles = sprite.getTiles(frame);
    for (let y = 0; y < 3; y++) {
        const height = yPos[y + 1] - yPos[y];
        if (height <= 0) {
            continue;
        }
        const top = yPos[y];
        for (let x = 0; x < 3; x++) {
            const width = xPos[x + 1] - xPos[x];
            if (width <= 0 || height <= 0) {
                continue;
            }
            const left = xPos[x];
            const tileIndex = y * 3 + x;
            const tile = tiles[tileIndex];
            divs.push(`<div
            class="
                ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
                ${options.styleTable.oneTimeStyle('corneredtilesprite-tile', () => `
                    left: ${left}px;
                    top: ${top}px;
                    width: ${width}px;
                    height: ${height}px;
                `)}
                ${options.styleTable.style(`corneredtilesprite-img-${sprite.id}-${frame}-${x}-${y}`, () => `
                    background: url(${tile.uri});
                    background-size: ${tile.width}px ${tile.height}px;
                    background-repeat: repeat;
                    background-position: ${x === 2 ? 'right' : 'left'} ${y === 2 ? 'bottom' : 'top'};
                `)}
            "></div>
            `);
        }
    }
    return `<div
    ${(options === null || options === void 0 ? void 0 : options.id) ? `id="${options.id}"` : ''}
    class="
        ${(options === null || options === void 0 ? void 0 : options.classNames) ? options.classNames : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('corneredtilesprite', () => `
            left: ${position.x}px;
            top: ${position.y}px;
            width: ${size.width}px;
            height: ${size.height}px;
        `)}
    ">
        ${divs.join('')}
    </div>`;
}
exports.renderCorneredTileSprite = renderCorneredTileSprite;
function renderBackground(background, parentInfo, commonOptions) {
    var _a;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (background === undefined) {
            return '';
        }
        const backgroundSpriteName = (_a = background === null || background === void 0 ? void 0 : background.spritetype) !== null && _a !== void 0 ? _a : background === null || background === void 0 ? void 0 : background.quadtexturesprite;
        const backgroundSprite = backgroundSpriteName && commonOptions.getSprite ? yield commonOptions.getSprite(backgroundSpriteName, 'bg', background === null || background === void 0 ? void 0 : background.name) : undefined;
        if (backgroundSprite === undefined) {
            return '';
        }
        const [x, y, width, height] = (0, common_1.calculateBBox)({
            position: background.position,
            size: { width: (0, schema_1.parseNumberLike)('100%%'), height: (0, schema_1.parseNumberLike)('100%%') }
        }, parentInfo);
        return renderSprite({ x, y }, { width, height }, backgroundSprite, 0, 1, commonOptions);
    });
}
exports.renderBackground = renderBackground;
//# sourceMappingURL=nodecommon.js.map