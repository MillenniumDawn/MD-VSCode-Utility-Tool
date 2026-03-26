"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinentsLoader = void 0;
const tslib_1 = require("tslib");
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const common_1 = require("./common");
class ContinentsLoader extends common_1.FileLoader {
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return {
                result: yield loadContinents(this.file, e => this.fireOnProgressEvent(e)),
                warnings: [],
            };
        });
    }
    toString() {
        return `[ContinentsLoader: ${this.file}]`;
    }
}
exports.ContinentsLoader = ContinentsLoader;
function loadContinents(continentFile, progressReporter) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield progressReporter((0, i18n_1.localize)('worldmap.progress.loadingcontinents', 'Loading continents...'));
        return ['', ...(yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(continentFile, { continents: 'enum' })).continents._values];
    });
}
//# sourceMappingURL=continents.js.map