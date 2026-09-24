import { recordedPosts, resetWebviewState, takeRuntimeErrors } from './setup';
import * as assert from 'assert';
import { copyArray, tryRun, getState, setState, setPreviewOption, enableZoom, scrollToState, subscribeNavigators, subscribeRefreshButton, initCommon } from '../../../webviewsrc/util/common';

describe('webview/util/common', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
        resetWebviewState();
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
                assert.deepStrictEqual(takeRuntimeErrors().map(e => (e as Error).message), ['fail']);
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
                assert.deepStrictEqual(takeRuntimeErrors().map(e => (e as Error).message), ['async fail']);
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

        it('starts each test from an empty state', function () {
            assert.deepStrictEqual(getState(), {});
        });

        it('the vscode api replaces state rather than merging it', function () {
            const api = (global as any).acquireVsCodeApi();
            api.setState({ a: 1 });
            api.setState({ b: 2 });
            assert.deepStrictEqual(api.getState(), { b: 2 });
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
        function navigator(): HTMLDivElement {
            const el = document.createElement('div');
            el.className = 'navigator';
            el.setAttribute('start', '5');
            el.setAttribute('end', '10');
            el.setAttribute('file', 'test.txt');
            document.body.appendChild(el);
            return el;
        }

        it('makes navigators buttons that activate with Enter and Space', function () {
            const el = navigator();

            subscribeNavigators();

            assert.strictEqual(el.getAttribute('role'), 'button');
            assert.strictEqual(el.tabIndex, 0);

            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
            el.dispatchEvent(space);

            assert.strictEqual(space.defaultPrevented, true);
            assert.deepStrictEqual(recordedPosts(), [
                { command: 'navigate', start: 5, end: 10, file: 'test.txt' },
                { command: 'navigate', start: 5, end: 10, file: 'test.txt' },
            ]);
        });

        it('does not wire the same navigator more than once', function () {
            const el = navigator();

            subscribeNavigators();
            subscribeNavigators();
            el.dispatchEvent(new Event('click'));

            assert.deepStrictEqual(recordedPosts(), [
                { command: 'navigate', start: 5, end: 10, file: 'test.txt' },
            ]);
        });

        // A node with no known position renders `start="undefined"`, which must reach the host as
        // no range at all rather than as NaN.
        it('sends no line range for a navigator without a position', function () {
            const el = navigator();
            el.setAttribute('start', 'undefined');
            el.removeAttribute('end');

            subscribeNavigators();
            el.dispatchEvent(new Event('click'));

            assert.deepStrictEqual(recordedPosts(), [
                { command: 'navigate', start: undefined, end: undefined, file: 'test.txt' },
            ]);
        });
    });

    describe('subscribeRefreshButton', function () {
        it('asks the host for a reload and disables the button until it arrives', function () {
            const btn = document.createElement('button');
            btn.id = 'refresh';
            document.body.appendChild(btn);

            subscribeRefreshButton();
            btn.dispatchEvent(new Event('click'));

            assert.deepStrictEqual(recordedPosts(), [{ command: 'reload' }]);
            assert.strictEqual(btn.disabled, true);
        });

        it('posts nothing on a page without a refresh button', function () {
            subscribeRefreshButton();

            assert.deepStrictEqual(recordedPosts(), []);
        });
    });

    describe('setPreviewOption', function () {
        it('hands the toggle to the host, which keeps it across panels', function () {
            setPreviewOption('showIds', true);

            assert.deepStrictEqual(recordedPosts(), [
                { command: 'setPreviewOption', key: 'showIds', value: true },
            ]);
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

        // A trackpad swipe: jsdom implements no wheelDeltaY, which is exactly what a trackpad's
        // deltas look like to the classifier -- nothing that is a whole number of detents.
        const wheel = (init: Record<string, unknown>) => {
            const e = new (window as any).WheelEvent('wheel', { cancelable: true, ...init });
            window.dispatchEvent(e);
            return e;
        };

        // A mouse notch: the legacy wheelDeltaY a real wheel reports, which jsdom does not, so it
        // is defined on the event by hand before the dispatch.
        const mouseWheel = (init: Record<string, unknown> = {}) => {
            const { wheelDeltaY = -120, ...rest } = init as { wheelDeltaY?: number };
            const e = new (window as any).WheelEvent('wheel', { cancelable: true, deltaY: 100, ...rest });
            Object.defineProperty(e, 'wheelDeltaY', { value: wheelDeltaY });
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
            delete (window as any).previewWheel;
        });

        it('sets initial transform on the element', function () {
            assert.ok(zoomable().style.transform.includes('scale'));
        });

        // Issue #336: with the wheel zooming by default, a few notches shrank the tree until it fit
        // the pane, the scrollbar went, and the wheel -- swallowed even at the clamp -- moved
        // nothing. A bare wheel now scrolls unless the reader set the wheel to zoom.
        it('leaves a plain mouse wheel to scroll the page by default', function () {
            const div = zoomable();
            const e = mouseWheel({ pageX: 100, pageY: 100 });
            assert.strictEqual(e.defaultPrevented, false, 'the page must be free to scroll');
            assert.strictEqual(div.style.transform, 'scale(1)');
            assert.strictEqual(scrolledTo, undefined);
        });

        it('leaves a plain trackpad wheel to scroll the page, so a two-finger swipe pans', function () {
            const div = zoomable();
            const e = wheel({ deltaY: 120 });
            assert.strictEqual(e.defaultPrevented, false, 'the page must be free to scroll');
            assert.strictEqual(div.style.transform, 'scale(1)');
        });

        it('leaves a wheel to scroll when previewWheel is not one of the three', function () {
            const div = zoomable();
            (window as any).previewWheel = 'sideways';
            const e = mouseWheel({ pageX: 0, pageY: 0 });
            assert.strictEqual(e.defaultPrevented, false);
            assert.strictEqual(div.style.transform, 'scale(1)');
        });

        it('never zooms on a bare wheel when the reader set previewWheel to scroll', function () {
            const div = zoomable();
            (window as any).previewWheel = 'scroll';
            const e = mouseWheel({ pageX: 0, pageY: 0 });
            assert.strictEqual(e.defaultPrevented, false);
            assert.strictEqual(div.style.transform, 'scale(1)');

            wheel({ deltaY: 120, ctrlKey: true, pageX: 0, pageY: 0 });
            assert.strictEqual(div.style.transform, 'scale(0.8)', 'ctrl+wheel still zooms');
        });

        it('always zooms when the reader set previewWheel to zoom', function () {
            const div = zoomable();
            (window as any).previewWheel = 'zoom';
            const e = wheel({ deltaY: 120, pageX: 0, pageY: 0 });
            assert.strictEqual(e.defaultPrevented, true);
            assert.strictEqual(div.style.transform, 'scale(0.8)');
        });

        describe('with previewWheel set to auto', function () {
            beforeEach(function () {
                (window as any).previewWheel = 'auto';
            });

            it('leaves a fractional, sideways trackpad wheel to scroll', function () {
                const div = zoomable();
                const e = mouseWheel({ deltaY: 4.5, deltaX: 2, wheelDeltaY: -13.5 });
                assert.strictEqual(e.defaultPrevented, false);
                assert.strictEqual(div.style.transform, 'scale(1)');
            });

            it('zooms on a plain mouse wheel, which is a desktop reader\'s only zoom gesture', function () {
                const div = zoomable();
                const e = mouseWheel({ pageX: 100, pageY: 100 });
                assert.strictEqual(e.defaultPrevented, true);
                assert.strictEqual(div.style.transform, 'scale(0.8)');
                assert.ok(scrolledTo, 'the zoom anchors by scrolling');
            });

            it('zooms on a line-mode wheel, which only a mouse sends', function () {
                const div = zoomable();
                wheel({ deltaY: 3, deltaMode: 1, pageX: 0, pageY: 0 });
                assert.strictEqual(div.style.transform, 'scale(0.8)');
            });

            it('keeps scrolling through a trackpad burst that throws a detent-sized delta', function () {
                const div = zoomable();
                wheel({ deltaY: 6 });
                const e = mouseWheel({ deltaY: 100 });
                assert.strictEqual(e.defaultPrevented, false, 'still the same swipe');
                assert.strictEqual(div.style.transform, 'scale(1)');
            });

            it('scrolls for a high-resolution wheel, whose deltas are not detents', function () {
                const div = zoomable();
                mouseWheel({ deltaY: 33, wheelDeltaY: -40 });
                assert.strictEqual(div.style.transform, 'scale(1)');
            });
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

            // jsdom lays nothing out, so what the fix for #344 does to the scroll range cannot be
            // seen here; what can be pinned is the order it depends on -- the canvas is measured
            // after the transform is written and before the readout is, which is the one flush
            // Chromium needs to settle the transform's overflow on its own.
            it('measures the canvas between the transform and the readout, so the scroll range follows the zoom', function () {
                const div = zoomable();
                const level = document.getElementById('zoom-level')!;
                const measured: { transform: string; level: string }[] = [];
                div.getBoundingClientRect = () => {
                    measured.push({ transform: div.style.transform, level: level.textContent ?? '' });
                    return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) };
                };

                key({ key: '-' });

                assert.deepStrictEqual(measured, [{ transform: 'scale(0.8)', level: '100%' }]);
                assert.strictEqual(level.textContent, '80%');
            });
        });
    });

    describe('drag to pan', function () {
        it('scrolls once per frame to where the last mouse position points, not once per event', async function () {
            document.body.innerHTML = '<div id="dragger"></div>';
            const calls: [number, number][] = [];
            const orig = window.scroll;
            (window as any).scroll = (x: number, y: number) => { calls.push([x, y]); };
            try {
                // initCommon wires the dragger on load; this is the one call in this file, so the
                // listener it registers is not doubled by the describe below.
                initCommon();
                window.dispatchEvent(new Event('load'));
                calls.length = 0; // the load handler restores the saved scroll position first
                const dragger = document.getElementById('dragger')!;

                const move = (clientX: number, clientY: number) =>
                    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
                const frame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

                dragger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 50 }));
                move(90, 45);
                move(80, 40);
                assert.deepStrictEqual(calls, []);

                await frame();
                // jsdom has no scroll offset, so pageX at press time equals clientX: the target is
                // press position minus the latest pointer position. Other suites sharing this page
                // may have wired the dragger too, so the count is per wiring rather than one.
                assert.ok(calls.length >= 1);
                assert.ok(calls.every(c => c[0] === 20 && c[1] === 10), JSON.stringify(calls));
                const perFrame = calls.length;

                move(70, 35);
                move(60, 30);
                move(50, 25);
                await frame();
                assert.strictEqual(calls.length, perFrame * 2);
                assert.ok(calls.slice(perFrame).every(c => c[0] === 50 && c[1] === 25), JSON.stringify(calls));

                document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                move(0, 0);
                await frame();
                assert.strictEqual(calls.length, perFrame * 2);
            } finally {
                // Whatever happened above, the shared page must not be left mid-drag for the other
                // suites, which read the panning signal.
                document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                window.scroll = orig;
                document.body.innerHTML = '';
            }
        });
    });

    describe('initCommon', function () {
        it('does not throw on repeated calls', function () {
            assert.doesNotThrow(initCommon);
        });
    });
});
