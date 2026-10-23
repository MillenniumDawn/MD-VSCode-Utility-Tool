import './setup';
import * as assert from 'assert';
import { DivDropdown, enableDropdowns, numDropDownOpened$ } from '../../../webviewsrc/util/dropdown';

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

    it('opens on mousedown and closes on the next one', function () {
        const dd = buildDivDropdown(['a', 'b']);
        const opened = new Event('mousedown', { cancelable: true });
        dd.select.dispatchEvent(opened);
        assert.strictEqual(opened.defaultPrevented, true);
        assert.ok(dd.select.classList.contains('dropdown-opened'));

        dd.select.dispatchEvent(new Event('mousedown', { cancelable: true }));
        assert.ok(!dd.select.classList.contains('dropdown-opened'));
        dd.dispose();
    });

    it('opens and closes on Enter as well', function () {
        const dd = buildDivDropdown(['a', 'b']);
        dd.select.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', cancelable: true }));
        assert.ok(dd.select.classList.contains('dropdown-opened'));
        assert.strictEqual(numDropDownOpened$.value, 1);

        dd.select.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', cancelable: true }));
        assert.ok(!dd.select.classList.contains('dropdown-opened'));
        assert.strictEqual(numDropDownOpened$.value, 0);
        dd.dispose();
    });

    it('takes a pick from the open menu and closes a single-select one', function () {
        const dd = buildDivDropdown(['a', 'b']);
        dd.select.dispatchEvent(new Event('mousedown', { cancelable: true }));
        (document.querySelectorAll('ul.select-dropdown li')[1] as HTMLElement).click();

        assert.deepStrictEqual(dd.selectedValues$.value, ['b']);
        assert.strictEqual((dd.select.querySelector('span.value') as HTMLSpanElement).textContent, 'b');
        assert.ok(!dd.select.classList.contains('dropdown-opened'));
        assert.strictEqual(numDropDownOpened$.value, 0);
        dd.dispose();
    });

    // enableDropdowns puts the same menu over every native <select> in a select container.
    it('sets a native select to the option picked and reports the change', function () {
        document.body.innerHTML = `
            <div class="select-container"><select id="native">
                <option value="a">A</option><option value="b">B</option><option value="c" hidden>C</option>
            </select></div>`;
        enableDropdowns();
        const select = document.getElementById('native') as HTMLSelectElement;
        const changes: string[] = [];
        select.addEventListener('change', () => changes.push(select.value));

        select.dispatchEvent(new Event('mousedown', { cancelable: true }));
        const items = document.querySelectorAll('ul.select-dropdown li');
        assert.strictEqual(items.length, 2, 'a hidden option is not offered');
        (items[1] as HTMLElement).click();

        assert.strictEqual(select.value, 'b');
        assert.deepStrictEqual(changes, ['b']);
        assert.ok(!select.classList.contains('dropdown-opened'));
        assert.strictEqual(numDropDownOpened$.value, 0);
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
