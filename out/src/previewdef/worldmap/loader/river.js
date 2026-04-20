"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiverLoader = void 0;
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const bmpparser_1 = require("../../../util/image/bmp/bmpparser");
const common_1 = require("./common");
class RiverLoader extends common_1.FileLoader {
    async loadFromFile() {
        const warnings = [];
        return {
            result: await loadRivers(this.file, e => this.fireOnProgressEvent(e), warnings),
            warnings,
        };
    }
    extraMesurements(result) {
        return {
            ...super.extraMesurements(result),
            riverCount: result.result.rivers.length,
        };
    }
    toString() {
        return `[RiverLoader: ${this.file}]`;
    }
}
exports.RiverLoader = RiverLoader;
async function loadRivers(file, progressReporter, warnings) {
    progressReporter((0, i18n_1.localize)('worldmap.progress.loadingrivers', 'Loading rivers...'));
    const [riversImageBuffer] = await (0, fileloader_1.readFileFromModOrHOI4)(file);
    const riversImage = (0, bmpparser_1.parseBmp)(riversImageBuffer.buffer, riversImageBuffer.byteOffset);
    const result = {
        width: riversImage.width,
        height: riversImage.height,
        rivers: [],
    };
    if (riversImage.bitsPerPixel !== 8) {
        warnings.push({
            relatedFiles: [file],
            text: (0, i18n_1.localize)('worldmap.warning.riverimagebpp', 'The rivers image should be 8 bits per pixel, but it is {0}.', riversImage.bitsPerPixel),
            source: [{ type: 'river', name: '', index: -1 }]
        });
        return result;
    }
    const rivers = findRiverPointsList(riversImage);
    result.rivers = rivers;
    validateRivers(file, rivers, warnings);
    return result;
}
function findRiverPointsList(riversImage) {
    const result = [];
    for (let y = riversImage.height - 1, sy = 0, dy = (riversImage.height - 1) * riversImage.width; y >= 0; y--, sy += riversImage.bytesPerRow, dy -= riversImage.width) {
        for (let x = 0, sx = sy, dx = dy; x < riversImage.width; x++, sx++, dx++) {
            const color = riversImage.data[sx];
            if (color > 11) {
                continue;
            }
            result.push(findRiverPoints(x, y, riversImage));
        }
    }
    return result;
}
function findRiverPoints(startX, startY, riversImage) {
    const colors = {};
    const ends = [];
    const boundingBox = { x: startX, y: startY, w: 1, h: 1 };
    const stack = [];
    stack.push({ x: startX, y: startY });
    let firstPoint = true;
    while (stack.length > 0) {
        const point = stack.pop();
        const { x, y } = point;
        const si = (riversImage.height - 1 - y) * riversImage.bytesPerRow + x;
        const di = y * riversImage.width + x;
        colors[di] = riversImage.data[si];
        riversImage.data[si] = 255;
        let adjecents = 0;
        if (x > 0 && riversImage.data[si - 1] <= 11) {
            stack.push({ x: x - 1, y });
            adjecents++;
        }
        if (x < riversImage.width - 1 && riversImage.data[si + 1] <= 11) {
            stack.push({ x: x + 1, y });
            adjecents++;
        }
        if (y > 0 && riversImage.data[si + riversImage.bytesPerRow] <= 11) {
            stack.push({ x, y: y - 1 });
            adjecents++;
        }
        if (y < riversImage.height - 1 && riversImage.data[si - riversImage.bytesPerRow] <= 11) {
            stack.push({ x, y: y + 1 });
            adjecents++;
        }
        if (adjecents === 0 || (adjecents === 1 && firstPoint)) {
            ends.push(di);
        }
        (0, common_1.addPointToZone)(boundingBox, point);
        firstPoint = false;
    }
    const convertedColors = {};
    for (const key in colors) {
        const value = colors[key];
        const di = parseInt(key, 10);
        const x = di % riversImage.width;
        const y = Math.floor(di / riversImage.width);
        convertedColors[(y - boundingBox.y) * boundingBox.w + (x - boundingBox.x)] = value;
    }
    const convertedEnds = [];
    for (const end of ends) {
        const x = end % riversImage.width;
        const y = Math.floor(end / riversImage.width);
        convertedEnds.push((y - boundingBox.y) * boundingBox.w + (x - boundingBox.x));
    }
    return {
        colors: convertedColors,
        ends: convertedEnds,
        boundingBox,
    };
}
function validateRivers(file, rivers, warnings) {
    for (let i = 0; i < rivers.length; i++) {
        validateRiver(file, i, rivers[i], warnings);
    }
}
function validateRiver(file, index, river, warning) {
    if (river.ends.length === 0) {
        warning.push({
            relatedFiles: [file],
            text: (0, i18n_1.localize)('worldmap.warning.rivernoends', 'River has no end points.'),
            source: [{ type: 'river', name: riverToString(river), index: index }]
        });
    }
    const sources = river.ends.filter(end => river.colors[end] === 0);
    if (sources.length === 0) {
        warning.push({
            relatedFiles: [file],
            text: (0, i18n_1.localize)('worldmap.warning.rivernosource', 'River has no source. Its end points are: {0}.', river.ends.map(e => riverToString(river, e)).join(', ')),
            source: [{ type: 'river', name: riverToString(river, river.ends[0]), index: index }]
        });
    }
    if (sources.length > 1) {
        warning.push({
            relatedFiles: [file],
            text: (0, i18n_1.localize)('worldmap.warning.rivermultiplesource', 'River has multiple sources: {0}.', sources.map(s => riverToString(river, s)).join(', ')),
            source: [{ type: 'river', name: riverToString(river, sources[0]), index: index }]
        });
    }
    if (sources.length > 0) {
        const nonSourceEnds = river.ends.filter(end => river.colors[end] !== 0);
        for (const end of nonSourceEnds) {
            validateJoiningRiver(file, index, river, end, warning);
        }
    }
}
function validateJoiningRiver(file, index, river, end, warning) {
    if (river.colors[end] === undefined || river.colors[end] <= 2 || river.colors[end] > 11) {
        return;
    }
    let current = end;
    const searched = {};
    const candidates = [];
    while (true) {
        candidates.length = 0;
        if (current % river.boundingBox.w > 0) {
            candidates.push(current - 1);
        }
        if (current % river.boundingBox.w < river.boundingBox.w - 1) {
            candidates.push(current + 1);
        }
        if (current >= river.boundingBox.w) {
            candidates.push(current - river.boundingBox.w);
        }
        if (current < river.boundingBox.w * (river.boundingBox.h - 1)) {
            candidates.push(current + river.boundingBox.w);
        }
        searched[current] = true;
        let next = -1;
        let adjecentToMark = false;
        for (const candidate of candidates) {
            if (searched[candidate]) {
                continue;
            }
            const candidateColor = river.colors[candidate];
            if (candidateColor === undefined) {
                continue;
            }
            if (candidateColor <= 2) {
                adjecentToMark = true;
                continue;
            }
            if (next === -1) {
                next = candidate;
            }
            else {
                warning.push({
                    relatedFiles: [file],
                    text: (0, i18n_1.localize)('worldmap.warning.rivernoflowinorout', 'River doesn\'t have flow-in or flow-out mark at {0}.', riverToString(river, current)),
                    source: [{ type: 'river', name: riverToString(river, end), index: index }]
                });
                return;
            }
        }
        if (next === -1) {
            if (!adjecentToMark) {
                warning.push({
                    relatedFiles: [file],
                    text: (0, i18n_1.localize)('worldmap.warning.rivermayloop', 'River may contain a loop at {0} ~ {1}.', riverToString(river, end), riverToString(river, current)),
                    source: [{ type: 'river', name: riverToString(river, end), index: index }]
                });
            }
            return;
        }
        current = next;
    }
}
function riverToString(river, point) {
    if (point === undefined) {
        point = parseInt(Object.keys(river.colors)[0], 10);
    }
    const x = point % river.boundingBox.w + river.boundingBox.x;
    const y = Math.floor(point / river.boundingBox.w) + river.boundingBox.y;
    return `(${x}, ${y})`;
}
//# sourceMappingURL=river.js.map