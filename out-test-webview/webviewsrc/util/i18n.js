"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feLocalize = feLocalize;
let table = {};
try {
    table = window['__i18ntable'];
    if (!table) {
        console.error('Table not filled.');
        table = {};
    }
}
catch (e) {
    console.error(e);
}
function feLocalize(key, message, ...args) {
    if (key in table) {
        message = table[key];
    }
    const regex = new RegExp('\\{(' + args.map((_, i) => i.toString()).join('|') + ')\\}', 'g');
    return message.replace(regex, (_, group1) => args[parseInt(group1)]?.toString());
}
//# sourceMappingURL=i18n.js.map