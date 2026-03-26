"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBehaviorSubject = exports.Subscriber = exports.toDisposable = void 0;
const rxjs_1 = require("rxjs");
function toDisposable(...subscription) {
    return {
        dispose: () => subscription.forEach(s => s.unsubscribe())
    };
}
exports.toDisposable = toDisposable;
class Subscriber {
    constructor() {
        this.rxjsSubscriptions = [];
        this.subscriptions = [];
    }
    addSubscription(subscription) {
        if ('dispose' in subscription) {
            this.subscriptions.push(subscription);
        }
        else {
            this.rxjsSubscriptions.push(subscription);
        }
    }
    dispose() {
        this.subscriptions.forEach(s => s.dispose());
        toDisposable(...this.rxjsSubscriptions).dispose();
    }
}
exports.Subscriber = Subscriber;
function toBehaviorSubject(element, initialValue) {
    if (initialValue !== undefined) {
        element.value = initialValue;
    }
    const disposables = [];
    const observable = new rxjs_1.BehaviorSubject(element.value);
    let changing = false;
    disposables.push(observable.subscribe({
        next: v => {
            if (changing) {
                return;
            }
            changing = true;
            element.value = v;
            changing = false;
        },
        complete: () => {
            disposables.forEach(d => d.unsubscribe());
        }
    }));
    disposables.push((0, rxjs_1.fromEvent)(element, 'change').subscribe(() => {
        if (changing) {
            return;
        }
        changing = true;
        observable.next(element.value);
        changing = false;
    }));
    return observable;
}
exports.toBehaviorSubject = toBehaviorSubject;
//# sourceMappingURL=event.js.map