"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinentsLoader = void 0;
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const common_1 = require("./common");
class ContinentsLoader extends common_1.FileLoader {
    async loadFromFile() {
        return {
            result: await loadContinents(this.file, e => this.fireOnProgressEvent(e)),
            warnings: [],
        };
    }
    toString() {
        return `[ContinentsLoader: ${this.file}]`;
    }
}
exports.ContinentsLoader = ContinentsLoader;
async function loadContinents(continentFile, progressReporter) {
    await progressReporter((0, i18n_1.localize)('worldmap.progress.loadingcontinents', 'Loading continents...'));
    return ['', ...(await (0, fileloader_1.readFileFromModOrHOI4AsJson)(continentFile, { continents: 'enum' })).continents._values];
}
//# sourceMappingURL=continents.js.map