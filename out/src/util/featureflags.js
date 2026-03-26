"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localisationIndex = exports.gfxIndex = exports.sharedFocusIndex = exports.eventTreePreview = exports.useConditionInFocus = void 0;
const vsccommon_1 = require("./vsccommon");
const featureFlags = (0, vsccommon_1.getConfiguration)().featureFlags;
exports.useConditionInFocus = !featureFlags.includes('!useConditionInFocus');
exports.eventTreePreview = !featureFlags.includes('!eventTreePreview');
exports.sharedFocusIndex = !featureFlags.includes('!sharedFocusIndex');
exports.gfxIndex = featureFlags.includes('gfxIndex');
exports.localisationIndex = featureFlags.includes('localisationIndex');
//# sourceMappingURL=featureflags.js.map