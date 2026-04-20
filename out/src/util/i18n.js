"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadI18n = loadI18n;
exports.localize = localize;
exports.localizeText = localizeText;
exports.i18nTableAsScript = i18nTableAsScript;
const debug_1 = require("./debug");
let table = {};
function loadI18n(locale) {
    const config = JSON.parse(process.env.VSCODE_NLS_CONFIG || '{}');
    locale = locale ?? config.locale ?? 'en';
    const splitLocale = locale.split('-');
    table = tryLoadTable(locale) ??
        (splitLocale.length > 1 ? tryLoadTable(splitLocale[0]) : undefined) ??
        {};
}
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
    return message.replace(regex, (_, group1) => args[parseInt(group1)]?.toString());
}
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
function i18nTableAsScript() {
    return 'window.__i18ntable = ' + JSON.stringify(table) + ';';
}
//# sourceMappingURL=i18n.js.map