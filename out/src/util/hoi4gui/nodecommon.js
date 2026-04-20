"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSprite = renderSprite;
exports.renderCorneredTileSprite = renderCorneredTileSprite;
exports.renderBackground = renderBackground;
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
    ${options?.id ? `id="${options.id}"` : ''}
    class="
        ${options?.classNames ? options.classNames : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('sprite', () => `
            left: ${position.x}px;
            top: ${position.y}px;
            width: ${sprite.width * scale}px;
            height: ${sprite.height * scale}px;
        `)}
        ${options.styleTable.style(`sprite-img-${sprite.id}-${frame}`, () => `
            background-image: url(${sprite.frames[frame]?.uri});
            background-size: ${sprite.width * scale}px ${sprite.height * scale}px;
        `)}
    "></div>`;
}
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
    ${options?.id ? `id="${options.id}"` : ''}
    class="
        ${options?.classNames ? options.classNames : ''}
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
async function renderBackground(background, parentInfo, commonOptions) {
    if (background === undefined) {
        return '';
    }
    const backgroundSpriteName = background?.spritetype ?? background?.quadtexturesprite;
    const backgroundSprite = backgroundSpriteName && commonOptions.getSprite ? await commonOptions.getSprite(backgroundSpriteName, 'bg', background?.name) : undefined;
    if (backgroundSprite === undefined) {
        return '';
    }
    const [x, y, width, height] = (0, common_1.calculateBBox)({
        position: background.position,
        size: { width: (0, schema_1.parseNumberLike)('100%%'), height: (0, schema_1.parseNumberLike)('100%%') }
    }, parentInfo);
    return renderSprite({ x, y }, { width, height }, backgroundSprite, 0, 1, commonOptions);
}
//# sourceMappingURL=nodecommon.js.map