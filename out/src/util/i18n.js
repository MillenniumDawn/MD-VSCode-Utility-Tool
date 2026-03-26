"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.i18nTableAsScript = exports.localizeText = exports.localize = exports.loadI18n = void 0;
const debug_1 = require("./debug");
let table = {};
function loadI18n(locale) {
    var _a, _b, _c;
    const config = JSON.parse(process.env.VSCODE_NLS_CONFIG || '{}');
    locale = (_a = locale !== null && locale !== void 0 ? locale : config.locale) !== null && _a !== void 0 ? _a : 'en';
    const splitLocale = locale.split('-');
    table = (_c = (_b = tryLoadTable(locale)) !== null && _b !== void 0 ? _b : (splitLocale.length > 1 ? tryLoadTable(splitLocale[0]) : undefined)) !== null && _c !== void 0 ? _c : {};
}
exports.loadI18n = loadI18n;
function tryLoadTable(locale) {
    try {
        const requireContext = require.context('../../i18n', false, /\/(?!template)[\w-]*\.ts$/);
        return requireContext('./' + locale + '.ts').default;
    }
    catch (e) {
        (0, debug_1.error)(e);
    }
    return undefined;
}
function localize(key, message, ...args) {
    if (key in table) {
        message = table[key];
    }
    const regex = new RegExp('\\{(' + args.map((_, i) => i.toString()).join('|') + ')\\}', 'g');
    return message.replace(regex, (_, group1) => { var _a; return (_a = args[parseInt(group1)]) === null || _a === void 0 ? void 0 : _a.toString(); });
}
exports.localize = localize;
function localizeText(text) {
    return text.replace(/%(.*?)(?:\|(.*?))?%/g, (substr, key, message) => {
        if (substr === '%%') {
            return '%';
        }
        if (!key) {
            return substr;
        }
        if (!message) {
            message = key;
        }
        return localize(key, message);
    });
}
exports.localizeText = localizeText;
function i18nTableAsScript() {
    return 'window.__i18ntable = ' + JSON.stringify(table) + ';';
}
exports.i18nTableAsScript = i18nTableAsScript;
//# sourceMappingURL=i18n.js.map