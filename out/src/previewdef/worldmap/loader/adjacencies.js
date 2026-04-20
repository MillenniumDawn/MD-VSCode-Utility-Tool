"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdjacenciesLoader = void 0;
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const common_1 = require("./common");
class AdjacenciesLoader extends common_1.FileLoader {
    async loadFromFile() {
        const warnings = [];
        return {
            result: await loadAdjacencies(this.file, e => this.fireOnProgressEvent(e), warnings),
            warnings,
        };
    }
    toString() {
        return `[AdjacenciesLoader: ${this.file}]`;
    }
}
exports.AdjacenciesLoader = AdjacenciesLoader;
async function loadAdjacencies(adjacenciesFile, progressReporter, warnings) {
    await progressReporter((0, i18n_1.localize)('worldmap.progress.loadingadjacencies', 'Loading adjecencies...'));
    const [adjecenciesBuffer] = await (0, fileloader_1.readFileFromModOrHOI4)(adjacenciesFile);
    const adjecencies = adjecenciesBuffer.toString().split(/(?:\r\n|\n|\r)/).map(line => line.split(/[,;]/)).filter((v, i) => i > 0 && v.length >= 9);
    return adjecencies.map(row => convertRowToAdjacencies(row, warnings)).filter((v) => !!v);
}
function convertRowToAdjacencies(adjacency, warnings) {
    const from = parseInt(adjacency[0]);
    const to = parseInt(adjacency[1]);
    const type = adjacency[2];
    const through = parseInt(adjacency[3]);
    const startX = parseInt(adjacency[4]);
    const startY = parseInt(adjacency[5]);
    const stopX = parseInt(adjacency[6]);
    const stopY = parseInt(adjacency[7]);
    const rule = adjacency[8];
    if (from === -1 || to === -1) {
        return undefined;
    }
    const start = !isNaN(startX) && !isNaN(startY) && startX !== -1 && startY !== -1 ? { x: startX, y: startY } : undefined;
    const stop = !isNaN(stopX) && !isNaN(stopY) && stopX !== -1 && stopY !== -1 ? { x: stopX, y: stopY } : undefined;
    return {
        from,
        to,
        type,
        through,
        start,
        stop,
        rule,
        row: adjacency,
    };
}
//# sourceMappingURL=adjacencies.js.map