"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CountriesLoader = void 0;
const tslib_1 = require("tslib");
const fileloader_1 = require("../../../util/fileloader");
const debug_1 = require("../../../util/debug");
const common_1 = require("./common");
const i18n_1 = require("../../../util/i18n");
const lodash_1 = require("lodash");
const countryTagsFileSchema = {
    _innerType: "string",
    _type: "map",
};
const countryFileSchema = {
    color: {
        _innerType: "enum",
        _type: "detailvalue",
    },
};
const colorsFileSchema = {
    _innerType: {
        color: {
            _innerType: "enum",
            _type: "detailvalue",
        },
    },
    _type: "map",
};
class CountriesLoader extends common_1.Loader {
    constructor() {
        super();
        this.countryLoaders = {};
        this.countryTagsLoader = new CountryTagsLoader();
        this.colorsLoader = new ColorsLoader();
        this.countryTagsLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.colorsLoader.onProgress(e => this.onProgressEmitter.fire(e));
    }
    shouldReloadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if ((yield this.countryTagsLoader.shouldReload(session)) || (yield this.colorsLoader.shouldReload(session))) {
                return true;
            }
            return (yield Promise.all(Object.values(this.countryLoaders).map(l => l.shouldReload(session)))).some(v => v);
        });
    }
    loadImpl(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingcountries', 'Loading countries...'));
            const tagsResult = yield this.countryTagsLoader.load(session);
            const countryTags = tagsResult.result;
            const countryResultPromises = [];
            const newCountryLoaders = {};
            for (const tag of countryTags) {
                let countryLoader = this.countryLoaders[tag.tag];
                if (!countryLoader) {
                    countryLoader = new CountryLoader(tag.tag, 'common/' + tag.file);
                    countryLoader.disableTelemetry = true;
                    countryLoader.onProgress(e => this.onProgressEmitter.fire(e));
                }
                countryResultPromises.push(countryLoader.load(session));
                newCountryLoaders[tag.tag] = countryLoader;
            }
            this.countryLoaders = newCountryLoaders;
            const countriesResult = yield Promise.all(countryResultPromises);
            const colorsFileResult = yield this.colorsLoader.load(session);
            const countries = countriesResult.map(r => r.result).filter((c) => c !== undefined);
            applyColorFromColorTxt(countries, colorsFileResult.result);
            const allResults = [tagsResult, colorsFileResult, ...countriesResult];
            return {
                result: countries,
                dependencies: (0, common_1.mergeInLoadResult)(allResults, 'dependencies'),
                warnings: (0, common_1.mergeInLoadResult)(allResults, 'warnings'),
            };
        });
    }
    extraMesurements(result) {
        return Object.assign(Object.assign({}, super.extraMesurements(result)), { fileCount: Object.keys(this.countryLoaders).length });
    }
    toString() {
        return '[CountriesLoader]';
    }
}
exports.CountriesLoader = CountriesLoader;
class CountryLoader extends common_1.FileLoader {
    constructor(tag, file) {
        super(file);
        this.tag = tag;
    }
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return { result: yield loadCountry(this.tag, this.file), warnings: [] };
        });
    }
    toString() {
        return `[CountryLoader: ${this.file}]`;
    }
}
class CountryTagsLoader extends common_1.FolderLoader {
    constructor() {
        super('common/country_tags', CountryTagLoader);
    }
    mergeFiles(fileResults) {
        return Promise.resolve({
            result: (0, lodash_1.flatMap)(fileResults, r => r.result),
            dependencies: [this.folder + '/*'],
            warnings: (0, common_1.mergeInLoadResult)(fileResults, 'warnings'),
        });
    }
    toString() {
        return `[CountryTagsLoader]`;
    }
}
class CountryTagLoader extends common_1.FileLoader {
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return { result: yield loadCountryTags(this.file), warnings: [] };
        });
    }
    toString() {
        return `[CountryTagLoader: ${this.file}]`;
    }
}
class ColorsLoader extends common_1.FileLoader {
    constructor() {
        super('common/countries/colors.txt');
    }
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                return {
                    result: yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(this.file, colorsFileSchema),
                    warnings: [],
                };
            }
            catch (e) {
                (0, debug_1.error)(e);
                return {
                    result: { _map: {}, _token: undefined },
                    warnings: [],
                };
            }
        });
    }
    toString() {
        return `[Colors]`;
    }
}
function loadCountryTags(countryTagsFile) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            const data = yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(countryTagsFile, countryTagsFileSchema);
            const result = [];
            for (const tag of Object.values(data._map)) {
                if (!tag._value || tag._key === 'dynamic_tags') {
                    continue;
                }
                result.push({
                    tag: tag._key,
                    file: tag._value,
                });
            }
            return result;
        }
        catch (e) {
            (0, debug_1.error)(e);
            return [];
        }
    });
}
function loadCountry(tag, countryFile) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            const data = yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(countryFile, countryFileSchema);
            return {
                tag,
                color: (0, common_1.convertColor)(data.color),
            };
        }
        catch (e) {
            (0, debug_1.error)(e);
            return undefined;
        }
    });
}
function applyColorFromColorTxt(countries, colorsFile) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        for (const country of countries) {
            const colorIncolors = colorsFile._map[country.tag];
            if (colorIncolors === null || colorIncolors === void 0 ? void 0 : colorIncolors._value.color) {
                country.color = (0, common_1.convertColor)(colorIncolors === null || colorIncolors === void 0 ? void 0 : colorIncolors._value.color);
            }
        }
    });
}
//# sourceMappingURL=countries.js.map