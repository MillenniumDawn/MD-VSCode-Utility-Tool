import './setup';
import * as assert from 'assert';
import { DivDropdown, numDropDownOpened$ } from '../../../webviewsrc/util/dropdown';

describe('webview/util/dropdown', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
        numDropDownOpened$.next(0);
    });

    function buildDivDropdown(values: string[], multi = false, initial?: string[], empty?: string) {
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

        const dd = new DivDropdown(div, multi, empty === undefined ? undefined : { empty });
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
        const span = dd.select.querySelector('span.value') as HTMLSpanElement;
        assert.ok(span.textContent?.includes('first'));

        dd.selectedValues$.next(['second']);
        assert.ok(span.textContent?.includes('second'));
    });

    it('announces an empty multi-selection as no selection', function () {
        const dd = buildDivDropdown(['x', 'y'], true);
        const span = dd.select.querySelector('span.value') as HTMLSpanElement;
        assert.strictEqual(span.textContent, '(No selection)');
    });

    // A list of filters means the opposite of a list of things picked out: selecting none of them
    // hides nothing, so the caller says what an empty selection means for it.
    it('lets the caller say what an empty selection means', function () {
        const dd = buildDivDropdown(['x', 'y'], true, undefined, '(All events)');
        const span = dd.select.querySelector('span.value') as HTMLSpanElement;
        assert.strictEqual(span.textContent, '(All events)');

        dd.selectedValues$.next(['x']);
        assert.strictEqual(span.textContent, 'x', 'the override is only for the empty selection');
    });

    it('does not throw on mousedown', function () {
        const dd = buildDivDropdown(['a', 'b']);
        dd.select.dispatchEvent(new Event('mousedown'));
        // Just verifies no exception
        dd.dispose();
    });

    it('increments open counter when dropdown opens', function (done) {
        const dd = buildDivDropdown(['a', 'b']);
        const sub = numDropDownOpened$.subscribe(n => {
            if (n === 1) {
                sub.unsubscribe();
                dd.dispose();
                done();
            }
        });
        dd.select.dispatchEvent(new Event('mousedown'));
    });
});
