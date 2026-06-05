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
const dropdown_1 = require("../../../webviewsrc/util/dropdown");
describe('webview/util/dropdown', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
        dropdown_1.numDropDownOpened$.next(0);
    });
    function buildDivDropdown(values, multi = false, initial) {
        const div = document.createElement('div');
        div.classList.add('select-container');
        const valueSpan = document.createElement('span');
        valueSpan.classList.add('value');
        div.appendChild(valueSpan);
        values.forEach(v => {
            const opt = document.createElement('div');
            opt.classList.add('option');
            opt.setAttribute('value', v);
            opt.textContent = v;
            div.appendChild(opt);
        });
        document.body.appendChild(div);
        const dd = new dropdown_1.DivDropdown(div, multi);
        if (initial) {
            dd.selectedValues$.next(initial);
        }
        return dd;
    }
    it('initializes with the first option selected (single)', function () {
        const dd = buildDivDropdown(['a', 'b', 'c']);
        assert.deepStrictEqual(dd.selectedValues$.value, ['a']);
    });
    it('selectAll selects every option', function () {
        const dd = buildDivDropdown(['x', 'y', 'z'], true);
        dd.selectAll();
        assert.deepStrictEqual(dd.selectedValues$.value, ['x', 'y', 'z']);
    });
    it('updates displayed text on selection change', function () {
        const dd = buildDivDropdown(['first', 'second']);
        const span = dd.select.querySelector('span.value');
        assert.ok(span.textContent?.includes('first'));
        dd.selectedValues$.next(['second']);
        assert.ok(span.textContent?.includes('second'));
    });
    it('does not throw on mousedown', function () {
        const dd = buildDivDropdown(['a', 'b']);
        dd.select.dispatchEvent(new Event('mousedown'));
        // Just verifies no exception
        dd.dispose();
    });
    it('increments open counter when dropdown opens', function (done) {
        const dd = buildDivDropdown(['a', 'b']);
        const sub = dropdown_1.numDropDownOpened$.subscribe(n => {
            if (n === 1) {
                sub.unsubscribe();
                dd.dispose();
                done();
            }
        });
        dd.select.dispatchEvent(new Event('mousedown'));
    });
});
//# sourceMappingURL=dropdown.test.js.map