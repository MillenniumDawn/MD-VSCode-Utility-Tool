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
const rxjs_1 = require("rxjs");
const event_1 = require("../../../webviewsrc/util/event");
describe('webview/util/event', function () {
    describe('toDisposable', function () {
        it('unsubscribes all given subscriptions on dispose', function () {
            const sub1 = new rxjs_1.Subscription();
            const sub2 = new rxjs_1.Subscription();
            let unsub1 = false, unsub2 = false;
            sub1.add(() => { unsub1 = true; });
            sub2.add(() => { unsub2 = true; });
            const d = (0, event_1.toDisposable)(sub1, sub2);
            d.dispose();
            assert.strictEqual(unsub1, true);
            assert.strictEqual(unsub2, true);
        });
    });
    describe('Subscriber', function () {
        it('disposes rxjs subscriptions', function () {
            const s = new event_1.Subscriber();
            const sub = new rxjs_1.Subscription();
            let unsubbed = false;
            sub.add(() => { unsubbed = true; });
            s.addSubscription(sub);
            s.dispose();
            assert.strictEqual(unsubbed, true);
        });
        it('disposes custom disposables', function () {
            const s = new event_1.Subscriber();
            let disposed = false;
            s.addSubscription({ dispose: () => { disposed = true; } });
            s.dispose();
            assert.strictEqual(disposed, true);
        });
    });
    describe('toBehaviorSubject', function () {
        it('syncs select value to subject', function () {
            const select = document.createElement('select');
            const opt1 = document.createElement('option');
            opt1.value = 'a';
            opt1.textContent = 'A';
            const opt2 = document.createElement('option');
            opt2.value = 'b';
            opt2.textContent = 'B';
            select.appendChild(opt1);
            select.appendChild(opt2);
            document.body.appendChild(select);
            const bs = (0, event_1.toBehaviorSubject)(select, 'b');
            assert.strictEqual(bs.value, 'b');
            assert.strictEqual(select.value, 'b');
            bs.unsubscribe();
        });
        it('pushes change event into subject', function (done) {
            const select = document.createElement('select');
            const opt1 = document.createElement('option');
            opt1.value = 'x';
            opt1.textContent = 'X';
            const opt2 = document.createElement('option');
            opt2.value = 'y';
            opt2.textContent = 'Y';
            select.appendChild(opt1);
            select.appendChild(opt2);
            document.body.appendChild(select);
            const bs = (0, event_1.toBehaviorSubject)(select, 'x');
            const sub = bs.subscribe(v => {
                if (v === 'y') {
                    sub.unsubscribe();
                    bs.unsubscribe();
                    done();
                }
            });
            select.value = 'y';
            select.dispatchEvent(new Event('change'));
        });
    });
});
//# sourceMappingURL=event.test.js.map