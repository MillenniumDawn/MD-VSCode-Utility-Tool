"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("./setup");
const assert = __importStar(require("assert"));
const i18n_1 = require("../../../webviewsrc/util/i18n");
describe('webview/util/i18n', function () {
    describe('feLocalize', function () {
        it('replaces arguments in the message', function () {
            const result = (0, i18n_1.feLocalize)('combobox.multiple', '{0} (+{1})', 'Alpha', 3);
            assert.strictEqual(result, 'Alpha (+3)');
        });
        it('falls back to default message when key is not in table', function () {
            const result = (0, i18n_1.feLocalize)('combobox.noselection', '(No selection)');
            assert.strictEqual(result, 'Translated value');
        });
        it('uses default message when key is absent', function () {
            const result = (0, i18n_1.feLocalize)('nonexistent.key', 'Default fallback');
            assert.strictEqual(result, 'Default fallback');
        });
        it('handles no arguments', function () {
            const result = (0, i18n_1.feLocalize)('test.key', 'Fallback');
            assert.strictEqual(result, 'Translated value');
        });
    });
});
//# sourceMappingURL=i18n.test.js.map