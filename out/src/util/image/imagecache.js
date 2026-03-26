"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSpriteByGfxName = exports.getImageByPath = exports.Image = exports.Sprite = void 0;
const tslib_1 = require("tslib");
const pngjs_1 = require("pngjs");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const spritetype_1 = require("../../hoiformat/spritetype");
const fileloader_1 = require("../fileloader");
const cache_1 = require("../cache");
const converter_1 = require("./converter");
const sprite_1 = require("./sprite");
Object.defineProperty(exports, "Sprite", { enumerable: true, get: function () { return sprite_1.Sprite; } });
Object.defineProperty(exports, "Image", { enumerable: true, get: function () { return sprite_1.Image; } });
const i18n_1 = require("../i18n");
const debug_1 = require("../debug");
const dds_1 = require("./dds");
const common_1 = require("../common");
const gfxindex_1 = require("../gfxindex");
const imageCache = new cache_1.PromiseCache({
    expireWhenChange: fileloader_1.hoiFileExpiryToken,
    factory: getImage,
    life: 10 * 60 * 1000
});
const spriteCache = new cache_1.PromiseCache({
    expireWhenChange: spriteCacheExpiryToken,
    factory: getSpriteByKey,
    life: 10 * 60 * 1000
});
const gfxMapCache = new cache_1.PromiseCache({
    expireWhenChange: fileloader_1.hoiFileExpiryToken,
    factory: loadGfxMap,
    life: 10 * 60 * 1000
});
function getImageByPath(relativePath) {
    return imageCache.get(relativePath);
}
exports.getImageByPath = getImageByPath;
function getSpriteByGfxName(name, gfxFilePath) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const pathFromIndex = yield (0, gfxindex_1.getGfxContainerFile)(name);
        if (pathFromIndex) {
            return yield spriteCache.get(pathFromIndex + '?' + name);
        }
        else if (Array.isArray(gfxFilePath)) {
            for (const path of gfxFilePath) {
                const result = yield spriteCache.get(path + '?' + name);
                if (result !== undefined) {
                    return result;
                }
            }
        }
        else {
            return yield spriteCache.get(gfxFilePath + '?' + name);
        }
        return undefined;
    });
}
exports.getSpriteByGfxName = getSpriteByGfxName;
function spriteCacheExpiryToken(key, spritePromise) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [gfxFilePath] = key.split('?');
        const gfxToken = yield (0, fileloader_1.hoiFileExpiryToken)(gfxFilePath);
        const sprite = yield spritePromise;
        if (sprite) {
            return `${gfxToken}:${(0, fileloader_1.expiryToken)(sprite.image.path)}`;
        }
        return gfxToken;
    });
}
function getSpriteByKey(key) {
    const [gfxFilePath, name] = key.split('?');
    return getSpriteByGfxNameImpl(name, gfxFilePath);
}
function getSpriteByGfxNameImpl(name, gfxFilePath) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const gfxMap = yield gfxMapCache.get(gfxFilePath);
        const sprite = gfxMap[name];
        if (sprite === undefined) {
            return undefined;
        }
        const image = yield imageCache.get(sprite.texturefile);
        if (image === undefined) {
            return undefined;
        }
        if ('bordersize' in sprite) {
            return new sprite_1.CorneredTileSprite(name, image, sprite.noofframes, sprite.size, sprite.bordersize);
        }
        return new sprite_1.Sprite(name, image, sprite.noofframes);
    });
}
function getImage(relativePath) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let readFileResult = undefined;
        try {
            readFileResult = yield (0, fileloader_1.readFileFromModOrHOI4)(relativePath);
        }
        catch (e) {
            if (!(e instanceof common_1.UserError)) {
                (0, debug_1.error)("Failed to get image " + relativePath);
            }
            (0, debug_1.error)(e);
            if (relativePath.length <= 4 || relativePath.endsWith('.dds')) {
                return undefined;
            }
            // in case .png or .tga not exist but .dds exist
            relativePath = relativePath.substr(0, relativePath.length - 4) + '.dds';
        }
        try {
            const [buffer, realPath] = readFileResult !== null && readFileResult !== void 0 ? readFileResult : yield (0, fileloader_1.readFileFromModOrHOI4)(relativePath);
            let png;
            let pngBuffer;
            relativePath = relativePath.toLowerCase();
            if (relativePath.endsWith('.dds')) {
                const dds = dds_1.DDS.parse(buffer.buffer, buffer.byteOffset);
                png = (0, converter_1.ddsToPng)(dds);
                pngBuffer = pngjs_1.PNG.sync.write(png);
            }
            else if (relativePath.endsWith('.tga')) {
                png = (0, converter_1.tgaToPng)(buffer);
                pngBuffer = pngjs_1.PNG.sync.write(png);
            }
            else if (relativePath.endsWith('.png')) {
                pngBuffer = buffer;
                png = pngjs_1.PNG.sync.read(buffer);
            }
            else {
                throw new common_1.UserError('Unsupported image type: ' + relativePath);
            }
            return new sprite_1.Image(pngBuffer, png.width, png.height, realPath);
        }
        catch (e) {
            if (!(e instanceof common_1.UserError)) {
                (0, debug_1.error)("Failed to get image " + relativePath);
            }
            (0, debug_1.error)(e);
            return undefined;
        }
    });
}
function loadGfxMap(path) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const gfxMap = {};
        try {
            const [buffer, realPath] = yield (0, fileloader_1.readFileFromModOrHOI4)(path);
            const gfx = buffer.toString('utf-8');
            const node = (0, hoiparser_1.parseHoi4File)(gfx, (0, i18n_1.localize)('infile', 'In file {0}:\n', realPath));
            const spriteTypes = (0, spritetype_1.getSpriteTypes)(node);
            spriteTypes.forEach(st => gfxMap[st.name] = st);
        }
        catch (e) {
            (0, debug_1.error)(e);
        }
        return gfxMap;
    });
}
//# sourceMappingURL=imagecache.js.map