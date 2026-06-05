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
const checkbox_1 = require("../../../webviewsrc/util/checkbox");
describe('webview/util/checkbox', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
    });
    describe('Checkbox class', function () {
        it('creates a visible checkbox container next to the input', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = true;
            document.body.appendChild(input);
            const cb = new checkbox_1.Checkbox(input);
            const container = input.nextElementSibling;
            assert.ok(container, 'container should be inserted after input');
            assert.ok(container.classList.contains('checkbox-container-out'));
            const inner = container.querySelector('.checkbox-container');
            assert.ok(inner);
            assert.strictEqual(inner.getAttribute('role'), 'checkbox');
            assert.strictEqual(inner.getAttribute('aria-checked'), 'true');
            cb.dispose();
        });
        it('syncs checked state on click', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = false;
            document.body.appendChild(input);
            const cb = new checkbox_1.Checkbox(input);
            const container = input.nextElementSibling.querySelector('.checkbox-container');
            container.dispatchEvent(new Event('click'));
            assert.strictEqual(input.checked, true);
            assert.strictEqual(container.getAttribute('aria-checked'), 'true');
            cb.dispose();
        });
        it('toggles on Enter / Space keydown', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = false;
            document.body.appendChild(input);
            const cb = new checkbox_1.Checkbox(input);
            const container = input.nextElementSibling.querySelector('.checkbox-container');
            container.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
            assert.strictEqual(input.checked, true);
            container.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
            assert.strictEqual(input.checked, false);
            cb.dispose();
        });
        it('removes generated DOM on dispose', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            document.body.appendChild(input);
            const cb = new checkbox_1.Checkbox(input);
            cb.dispose();
            assert.strictEqual(input.nextElementSibling, null);
        });
    });
});
//# sourceMappingURL=checkbox.test.js.map