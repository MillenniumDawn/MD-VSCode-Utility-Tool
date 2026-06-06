import './setup';
import * as assert from 'assert';
import { Subscription } from 'rxjs';
import { toDisposable, Subscriber, toBehaviorSubject } from '../../../webviewsrc/util/event';

describe('webview/util/event', function () {
    describe('toDisposable', function () {
        it('unsubscribes all given subscriptions on dispose', function () {
            const sub1 = new Subscription();
            const sub2 = new Subscription();
            let unsub1 = false, unsub2 = false;
            sub1.add(() => { unsub1 = true; });
            sub2.add(() => { unsub2 = true; });

            const d = toDisposable(sub1, sub2);
            d.dispose();

            assert.strictEqual(unsub1, true);
            assert.strictEqual(unsub2, true);
        });
    });

    describe('Subscriber', function () {
        it('disposes rxjs subscriptions', function () {
            const s = new Subscriber();
            const sub = new Subscription();
            let unsubbed = false;
            sub.add(() => { unsubbed = true; });
            s.addSubscription(sub);
            s.dispose();
            assert.strictEqual(unsubbed, true);
        });

        it('disposes custom disposables', function () {
            const s = new Subscriber();
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
            opt1.value = 'a'; opt1.textContent = 'A';
            const opt2 = document.createElement('option');
            opt2.value = 'b'; opt2.textContent = 'B';
            select.appendChild(opt1);
            select.appendChild(opt2);
            document.body.appendChild(select);

            const bs = toBehaviorSubject(select, 'b');
            assert.strictEqual(bs.value, 'b');
            assert.strictEqual(select.value, 'b');

            bs.unsubscribe();
        });

        it('pushes change event into subject', function (done) {
            const select = document.createElement('select');
            const opt1 = document.createElement('option');
            opt1.value = 'x'; opt1.textContent = 'X';
            const opt2 = document.createElement('option');
            opt2.value = 'y'; opt2.textContent = 'Y';
            select.appendChild(opt1);
            select.appendChild(opt2);
            document.body.appendChild(select);

            const bs = toBehaviorSubject(select, 'x');
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
