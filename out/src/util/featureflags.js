"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localisationIndex = exports.gfxIndex = exports.sharedFocusIndex = exports.eventTreePreview = exports.useConditionInFocus = void 0;
const vsccommon_1 = require("./vsccommon");
const config = (0, vsccommon_1.getConfiguration)();
exports.useConditionInFocus = config.useConditionInFocus;
exports.eventTreePreview = config.eventTreePreview;
exports.sharedFocusIndex = config.sharedFocusIndex;
exports.gfxIndex = config.gfxIndex;
exports.localisationIndex = config.localisationIndex;
//# sourceMappingURL=featureflags.js.map