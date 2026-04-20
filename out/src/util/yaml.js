"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseYaml = parseYaml;
const tslib_1 = require("tslib");
const yaml = tslib_1.__importStar(require("js-yaml"));
function parseYaml(content) {
    try {
        return yaml.safeLoad(content);
    }
    catch (e) {
        content = content.replace(/:\d+\s*"/g, ": \"").replace(/(?<=")((?:\\.|[^\\"\n\r])*?)"(?!\s*$)/gm, "$1\\\"");
    }
    return yaml.safeLoad(content);
}
//# sourceMappingURL=yaml.js.map