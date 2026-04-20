"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ddsToPng = ddsToPng;
exports.tgaToPng = tgaToPng;
const pngjs_1 = require("pngjs");
const common_1 = require("../common");
const TGA = require('tga');
function ddsToPng(dds) {
    const img = dds.images[0];
    const png = new pngjs_1.PNG({ width: img.width, height: img.height });
    const imgbuffer = img.getFullRgba();
    png.data = Buffer.from(imgbuffer);
    return png;
}
function tgaToPng(buffer) {
    const tga = new TGA(buffer);
    const png = new pngjs_1.PNG({ width: tga.width, height: tga.height });
    if (!tga.pixels) {
        throw new common_1.UserError('Unspported tga format');
    }
    png.data = Buffer.from(tga.pixels);
    return png;
}
//# sourceMappingURL=converter.js.map