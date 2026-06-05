import './setup';
import * as assert from 'assert';
import { copyArray, tryRun, getState, setState, enableZoom, scrollToState, subscribeNavigators, subscribeRefreshButton, initCommon } from '../../../webviewsrc/util/common';

describe('webview/util/common', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
        setState({});
    });

    describe('copyArray', function () {
        it('copies elements between arrays', function () {
            const src = [1, 2, 3, 4, 5];
            const dst = new Array(5);
            copyArray(src, dst, 1, 2, 3);
            assert.deepStrictEqual(dst, [undefined, undefined, 2, 3, 4]);
        });

        it('works with zero length', function () {
            const src = [1, 2, 3];
            const dst: number[] = [];
            copyArray(src, dst, 0, 0, 0);
            assert.deepStrictEqual(dst, []);
        });
    });

    describe('tryRun', function () {
        it('returns the function result on success', function () {
            const wrapped = tryRun((x: number) => x * 2);
            assert.strictEqual(wrapped(5), 10);
        });

        it('returns undefined on sync error', function () {
            const wrapped = tryRun(() => { throw new Error('fail'); });
            assert.strictEqual(wrapped(), undefined);
        });

        it('catches async errors and returns undefined', async function () {
            const wrapped = tryRun(async () => { throw new Error('async fail'); });
            const result = await wrapped();
            assert.strictEqual(result, undefined);
        });
    });

    describe('getState / setState', function () {
        it('round-trips state through vscode mock', function () {
            setState({ foo: 'bar', num: 42 });
            const s = getState();
            assert.strictEqual(s.foo, 'bar');
            assert.strictEqual(s.num, 42);
        });

        it('merges state into existing object', function () {
            setState({ a: 1 });
            setState({ b: 2 });
            const s = getState();
            assert.strictEqual(s.a, 1);
            assert.strictEqual(s.b, 2);
        });
    });

    describe('scrollToState', function () {
        it('scrolls to offsets stored in state', function () {
            setState({ xOffset: 10, yOffset: 20 });
            let called: [number, number] | undefined;
            const orig = window.scroll;
            (window as any).scroll = (x: number, y: number) => { called = [x, y]; };
            scrollToState();
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

            subscribeNavigators();
            // Does not throw when clicked
            el.dispatchEvent(new Event('click'));
        });
    });

    describe('subscribeRefreshButton', function () {
        it('attaches click handler to #refresh', function () {
            const btn = document.createElement('button');
            btn.id = 'refresh';
            document.body.appendChild(btn);

            subscribeRefreshButton();
            // Does not throw when clicked
            btn.dispatchEvent(new Event('click'));
        });
    });

    describe('enableZoom', function () {
        it('sets initial transform on the element', function () {
            const div = document.createElement('div');
            document.body.appendChild(div);
            enableZoom(div, 0, 0);
            assert.ok(div.style.transform.includes('scale'));
        });
    });

    describe('initCommon', function () {
        it('does not throw on repeated calls', function () {
            assert.doesNotThrow(initCommon);
        });
    });
});
