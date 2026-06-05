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
const common_1 = require("../../../webviewsrc/util/common");
describe('webview/util/common', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
        (0, common_1.setState)({});
    });
    describe('copyArray', function () {
        it('copies elements between arrays', function () {
            const src = [1, 2, 3, 4, 5];
            const dst = new Array(5);
            (0, common_1.copyArray)(src, dst, 1, 2, 3);
            assert.deepStrictEqual(dst, [undefined, undefined, 2, 3, 4]);
        });
        it('works with zero length', function () {
            const src = [1, 2, 3];
            const dst = [];
            (0, common_1.copyArray)(src, dst, 0, 0, 0);
            assert.deepStrictEqual(dst, []);
        });
    });
    describe('tryRun', function () {
        it('returns the function result on success', function () {
            const wrapped = (0, common_1.tryRun)((x) => x * 2);
            assert.strictEqual(wrapped(5), 10);
        });
        it('returns undefined on sync error', function () {
            const wrapped = (0, common_1.tryRun)(() => { throw new Error('fail'); });
            assert.strictEqual(wrapped(), undefined);
        });
        it('catches async errors and returns undefined', async function () {
            const wrapped = (0, common_1.tryRun)(async () => { throw new Error('async fail'); });
            const result = await wrapped();
            assert.strictEqual(result, undefined);
        });
    });
    describe('getState / setState', function () {
        it('round-trips state through vscode mock', function () {
            (0, common_1.setState)({ foo: 'bar', num: 42 });
            const s = (0, common_1.getState)();
            assert.strictEqual(s.foo, 'bar');
            assert.strictEqual(s.num, 42);
        });
        it('merges state into existing object', function () {
            (0, common_1.setState)({ a: 1 });
            (0, common_1.setState)({ b: 2 });
            const s = (0, common_1.getState)();
            assert.strictEqual(s.a, 1);
            assert.strictEqual(s.b, 2);
        });
    });
    describe('scrollToState', function () {
        it('scrolls to offsets stored in state', function () {
            (0, common_1.setState)({ xOffset: 10, yOffset: 20 });
            let called;
            const orig = window.scroll;
            window.scroll = (x, y) => { called = [x, y]; };
            (0, common_1.scrollToState)();
            assert.deepStrictEqual(called, [10, 20]);
            window.scroll = orig;
        });
    });
    describe('subscribeNavigators', function () {
        it('attaches click handler to .navigator elements', function () {
            const el = document.createElement('div');
            el.className = 'navigator';
            el.setAttribute('start', '5');
            el.setAttribute('end', '10');
            el.setAttribute('file', 'test.txt');
            document.body.appendChild(el);
            (0, common_1.subscribeNavigators)();
            // Does not throw when clicked
            el.dispatchEvent(new Event('click'));
        });
    });
    describe('subscribeRefreshButton', function () {
        it('attaches click handler to #refresh', function () {
            const btn = document.createElement('button');
            btn.id = 'refresh';
            document.body.appendChild(btn);
            (0, common_1.subscribeRefreshButton)();
            // Does not throw when clicked
            btn.dispatchEvent(new Event('click'));
        });
    });
    describe('enableZoom', function () {
        it('sets initial transform on the element', function () {
            const div = document.createElement('div');
            document.body.appendChild(div);
            (0, common_1.enableZoom)(div, 0, 0);
            assert.ok(div.style.transform.includes('scale'));
        });
    });
    describe('initCommon', function () {
        it('does not throw on repeated calls', function () {
            assert.doesNotThrow(common_1.initCommon);
        });
    });
});
//# sourceMappingURL=common.test.js.map