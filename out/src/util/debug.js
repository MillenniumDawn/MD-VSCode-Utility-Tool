"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debug = debug;
exports.error = error;
const telemetry_1 = require("./telemetry");
const common_1 = require("./common");
const js_yaml_1 = require("js-yaml");
function debug(message, ...args) {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...args);
    }
}
function error(error) {
    console.error(error);
    let realError = (0, common_1.forceError)(error);
    if (!(error instanceof common_1.UserError) && !(error instanceof js_yaml_1.YAMLException)) {
        (0, telemetry_1.sendException)(realError, { callerStack: new Error().stack ?? '' });
    }
}
//# sourceMappingURL=debug.js.map