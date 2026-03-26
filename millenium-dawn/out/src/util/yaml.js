"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseYaml = void 0;
const yaml = require("js-yaml");
function parseYaml(content) {
    try {
        return yaml.safeLoad(content);
    }
    catch (e) {
        content = content.replace(/:\d+\s*"/g, ": \"").replace(/(?<=")((?:\\.|[^\\"\n\r])*?)"(?!\s*$)/gm, "$1\\\"");
    }
    return yaml.safeLoad(content);
}
exports.parseYaml = parseYaml;
//# sourceMappingURL=yaml.js.map