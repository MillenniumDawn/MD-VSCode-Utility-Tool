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
            assert.strictEqual(dst.length, 5);
            assert.strictEqual(dst[0], undefined);
            assert.strictEqual(dst[1], undefined);
            assert.strictEqual(dst[2], 2);
            assert.strictEqual(dst[3], 3);
            assert.strictEqual(dst[4], 4);
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
            const originalConsoleError = console.error;
            console.error = () => undefined;
            try {
                const wrapped = tryRun(() => { throw new Error('fail'); });
                assert.strictEqual(wrapped(), undefined);
            } finally {
                console.error = originalConsoleError;
            }
        });

        it('catches async errors and returns undefined', async function () {
            const originalConsoleError = console.error;
            console.error = () => undefined;
            try {
                const wrapped = tryRun(async () => { throw new Error('async fail'); });
                const result = await wrapped();
                assert.strictEqual(result, undefined);
            } finally {
                console.error = originalConsoleError;
            }
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
        // jsdom implements neither, and enableZoom calls scrollTo on every step. Restored after each
        // test so nothing else in the shared document is left with a stub.
        let restoreScrolling: (() => void) | undefined;
        let scrolledTo: [number, number] | undefined;

        function zoomable(): HTMLDivElement {
            const div = document.createElement('div');
            document.body.appendChild(div);
            enableZoom(div, 0, 0);
            return div;
        }

        const wheel = (init: Record<string, unknown>) => {
            const e = new (window as any).WheelEvent('wheel', { cancelable: true, ...init });
            window.dispatchEvent(e);
            return e;
        };

        const key = (init: Record<string, unknown>, target: EventTarget = window) => {
            target.dispatchEvent(new (window as any).KeyboardEvent('keydown', { bubbles: true, ...init }));
        };

        beforeEach(function () {
            const originalScrollTo = window.scrollTo;
            scrolledTo = undefined;
            (window as any).scrollTo = (x: number, y: number) => { scrolledTo = [x, y]; };
            restoreScrolling = () => { window.scrollTo = originalScrollTo; };
        });

        afterEach(function () {
            restoreScrolling?.();
            // One state record is shared by the whole mocha run, and currentScale() reads it in
            // every later file, so the zoom these tests leave behind has to be put back.
            setState({ scale: 1 });
        });

        it('sets initial transform on the element', function () {
            assert.ok(zoomable().style.transform.includes('scale'));
        });

        it('leaves a plain wheel to scroll the page, so a trackpad pans', function () {
            const div = zoomable();
            const e = wheel({ deltaY: 120 });
            assert.strictEqual(e.defaultPrevented, false, 'the page must be free to scroll');
            assert.strictEqual(div.style.transform, 'scale(1)');
        });

        it('zooms on ctrl+wheel', function () {
            const div = zoomable();
            const e = wheel({ deltaY: 120, ctrlKey: true, pageX: 100, pageY: 100 });
            assert.strictEqual(e.defaultPrevented, true);
            assert.strictEqual(div.style.transform, 'scale(0.8)');
            assert.strictEqual(getState().scale, 0.8);
            assert.ok(scrolledTo, 'the zoom anchors by scrolling');
        });

        it('zooms on meta+wheel, which is the trackpad pinch', function () {
            const div = zoomable();
            wheel({ deltaY: 120, metaKey: true, pageX: 0, pageY: 0 });
            assert.strictEqual(div.style.transform, 'scale(0.8)');
        });

        it('clamps at both ends without drifting off whole percents', function () {
            const div = zoomable();
            for (let i = 0; i < 10; i++) {
                wheel({ deltaY: 120, ctrlKey: true, pageX: 0, pageY: 0 });
            }
            assert.strictEqual(div.style.transform, 'scale(0.2)');
            for (let i = 0; i < 10; i++) {
                wheel({ deltaY: -120, ctrlKey: true, pageX: 0, pageY: 0 });
            }
            assert.strictEqual(div.style.transform, 'scale(1)');
        });

        it('zooms on the +, - and numpad keys', function () {
            const div = zoomable();
            key({ key: '-' });
            assert.strictEqual(div.style.transform, 'scale(0.8)');
            key({ code: 'NumpadSubtract' });
            assert.strictEqual(div.style.transform, 'scale(0.6)');
            key({ key: '+' });
            assert.strictEqual(div.style.transform, 'scale(0.8)');
            key({ code: 'NumpadAdd' });
            assert.strictEqual(div.style.transform, 'scale(1)');
            key({ key: '=' });
            assert.strictEqual(div.style.transform, 'scale(1)', 'the ceiling holds');
        });

        it('leaves a modified key to VS Code', function () {
            const div = zoomable();
            key({ key: '-', ctrlKey: true });
            assert.strictEqual(div.style.transform, 'scale(1)');
        });

        it('does not zoom on a key typed into a text box or a dropdown', function () {
            const div = zoomable();
            const input = document.createElement('input');
            document.body.appendChild(input);
            key({ key: '-' }, input);
            assert.strictEqual(div.style.transform, 'scale(1)');

            const combobox = document.createElement('div');
            combobox.setAttribute('role', 'combobox');
            document.body.appendChild(combobox);
            key({ key: '-' }, combobox);
            assert.strictEqual(div.style.transform, 'scale(1)');
        });

        describe('the zoom controls', function () {
            it('appends one overlay however many times zoom is enabled', function () {
                zoomable();
                zoomable();
                assert.strictEqual(document.querySelectorAll('#zoom-controls').length, 1);
            });

            it('zooms from the buttons and shows the level', function () {
                const div = zoomable();
                (document.getElementById('zoom-out') as HTMLButtonElement).click();
                assert.strictEqual(div.style.transform, 'scale(0.8)');
                assert.strictEqual(document.getElementById('zoom-level')!.textContent, '80%');

                (document.getElementById('zoom-in') as HTMLButtonElement).click();
                assert.strictEqual(div.style.transform, 'scale(1)');
                assert.strictEqual(document.getElementById('zoom-level')!.textContent, '100%');
            });

            it('disables the button that can no longer do anything', function () {
                zoomable();
                const zoomIn = document.getElementById('zoom-in') as HTMLButtonElement;
                const zoomOut = document.getElementById('zoom-out') as HTMLButtonElement;
                assert.strictEqual(zoomIn.disabled, true, 'at the ceiling already');
                assert.strictEqual(zoomOut.disabled, false);

                for (let i = 0; i < 5; i++) {
                    zoomOut.click();
                }
                assert.strictEqual(zoomOut.disabled, true, 'at the floor');
                assert.strictEqual(zoomIn.disabled, false);
            });
        });
    });

    describe('initCommon', function () {
        it('does not throw on repeated calls', function () {
            assert.doesNotThrow(initCommon);
        });
    });
});
