"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventsLoader = void 0;
const tslib_1 = require("tslib");
const schema_1 = require("./schema");
const loader_1 = require("../../util/loader/loader");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const i18n_1 = require("../../util/i18n");
const lodash_1 = require("lodash");
const yaml_1 = require("../../util/loader/yaml");
const gfxindex_1 = require("../../util/gfxindex");
const vsccommon_1 = require("../../util/vsccommon");
const eventsGFX = 'interface/eventpictures.gfx';
class EventsLoader extends loader_1.ContentLoader {
    constructor() {
        super(...arguments);
        this.languageKey = '';
    }
    shouldReloadImpl(session) {
        const _super = Object.create(null, {
            shouldReloadImpl: { get: () => super.shouldReloadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return (yield _super.shouldReloadImpl.call(this, session)) || this.languageKey !== (0, vsccommon_1.getLanguageIdInYml)();
        });
    }
    postLoad(content, dependencies, error, session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (error || (content === undefined)) {
                throw error;
            }
            this.languageKey = (0, vsccommon_1.getLanguageIdInYml)();
            const eventsDependencies = dependencies.filter(d => d.type === 'event').map(d => d.path);
            const eventsDepFiles = yield this.loaderDependencies.loadMultiple(eventsDependencies, session, EventsLoader);
            const events = (0, schema_1.getEvents)((0, hoiparser_1.parseHoi4File)(content, (0, i18n_1.localize)('infile', 'In file {0}:\n', this.file)), this.file);
            const mergedEvents = mergeEvents(events, ...eventsDepFiles.map(f => f.result.events));
            const localizationDependencies = dependencies.filter(d => d.type.match(/^locali[sz]ation$/) && d.path.endsWith('.yml')).map(d => d.path);
            const localizationDepFiles = yield this.loaderDependencies.loadMultiple(localizationDependencies, session, yaml_1.YamlLoader);
            const localizationDict = makeLocalizationDict((0, loader_1.mergeInLoadResult)(localizationDepFiles, 'result'), this.languageKey);
            Object.assign(localizationDict, ...eventsDepFiles.map(f => f.result.localizationDict));
            const gfxDependencies = [
                ...dependencies.filter(d => d.type === 'gfx').map(d => d.path),
                ...(0, lodash_1.flatten)(eventsDepFiles.map(f => f.result.gfxFiles)),
                ...yield (0, gfxindex_1.getGfxContainerFiles)((0, lodash_1.flatten)(Object.values(events.eventItemsByNamespace)).map(e => e.picture)),
            ];
            return {
                result: {
                    events: mergedEvents,
                    mainNamespaces: Object.keys(events.eventItemsByNamespace),
                    gfxFiles: (0, lodash_1.uniq)([...gfxDependencies, eventsGFX]),
                    localizationDict,
                },
                dependencies: (0, lodash_1.uniq)([
                    this.file,
                    ...eventsDependencies,
                    ...(0, loader_1.mergeInLoadResult)(eventsDepFiles, 'dependencies'),
                    ...localizationDependencies,
                    ...(0, lodash_1.flatten)(eventsDepFiles.map(f => f.dependencies)),
                ])
            };
        });
    }
    toString() {
        return `[EventsLoader ${this.file}]`;
    }
}
exports.EventsLoader = EventsLoader;
function mergeEvents(...events) {
    return {
        eventItemsByNamespace: events.map(e => e.eventItemsByNamespace).reduce((p, c) => Object.assign(p, c), {}),
    };
}
function makeLocalizationDict(dicts, language) {
    const result = {};
    for (const dict of dicts) {
        if (dict[language] && typeof dict[language] === 'object' && !Array.isArray(dict[language])) {
            Object.assign(result, dict[language]);
        }
    }
    return result;
}
//# sourceMappingURL=loader.js.map