"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefinitionsLoader = void 0;
const tslib_1 = require("tslib");
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const common_1 = require("./common");
class DefinitionsLoader extends common_1.FileLoader {
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const warnings = [];
            return {
                result: yield loadDefinitions(this.file, e => this.fireOnProgressEvent(e), warnings),
                warnings,
            };
        });
    }
    toString() {
        return `[DefinitionsLoader: ${this.file}]`;
    }
}
exports.DefinitionsLoader = DefinitionsLoader;
function loadDefinitions(definitionsFile, progressReporter, warnings) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield progressReporter((0, i18n_1.localize)('worldmap.progress.loadingprovincedef', 'Loading province definitions...'));
        const [definitionsBuffer] = yield (0, fileloader_1.readFileFromModOrHOI4)(definitionsFile);
        const definition = definitionsBuffer.toString().split(/(?:\r\n|\n|\r)/).map(line => line.split(/[,;]/)).filter(v => v.length >= 8);
        return definition.map(row => convertRowToProvince(row, warnings));
    });
}
function convertRowToProvince(row, warnings) {
    const r = parseInt(row[1]);
    const g = parseInt(row[2]);
    const b = parseInt(row[3]);
    const type = row[4];
    const continent = parseInt(row[7]);
    return {
        id: parseInt(row[0]),
        color: (r << 16) | (g << 8) | b,
        type,
        coastal: row[5].trim().toLowerCase() === 'true',
        terrain: row[6],
        continent,
    };
}
//# sourceMappingURL=provincedefinitions.js.map