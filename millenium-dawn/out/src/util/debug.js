"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.error = exports.debug = void 0;
const telemetry_1 = require("./telemetry");
const common_1 = require("./common");
const js_yaml_1 = require("js-yaml");
function debug(message, ...args) {
    if (process.env.NODE_ENV !== 'production') {
        console.log(message, ...args);
    }
}
exports.debug = debug;
function error(error) {
    var _a;
    console.error(error);
    let realError = (0, common_1.forceError)(error);
    if (!(error instanceof common_1.UserError) && !(error instanceof js_yaml_1.YAMLException)) {
        (0, telemetry_1.sendException)(realError, { callerStack: (_a = new Error().stack) !== null && _a !== void 0 ? _a : '' });
    }
}
exports.error = error;
//# sourceMappingURL=debug.js.map