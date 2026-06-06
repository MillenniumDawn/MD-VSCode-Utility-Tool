import './setup';
import * as assert from 'assert';
import { Checkbox } from '../../../webviewsrc/util/checkbox';

describe('webview/util/checkbox', function () {
    beforeEach(function () {
        document.body.innerHTML = '';
    });

    describe('Checkbox class', function () {
        it('creates a visible checkbox container next to the input', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = true;
            document.body.appendChild(input);

            const cb = new Checkbox(input);

            const container = input.nextElementSibling as HTMLDivElement;
            assert.ok(container, 'container should be inserted after input');
            assert.ok(container.classList.contains('checkbox-container-out'));

            const inner = container.querySelector('.checkbox-container') as HTMLDivElement;
            assert.ok(inner);
            assert.strictEqual(inner.getAttribute('role'), 'checkbox');
            assert.strictEqual(inner.getAttribute('aria-checked'), 'true');

            cb.dispose();
        });

        it('syncs checked state on click', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = false;
            document.body.appendChild(input);

            const cb = new Checkbox(input);
            const container = (input.nextElementSibling as HTMLDivElement).querySelector('.checkbox-container') as HTMLDivElement;

            container.dispatchEvent(new Event('click'));
            assert.strictEqual(input.checked, true);
            assert.strictEqual(container.getAttribute('aria-checked'), 'true');

            cb.dispose();
        });

        it('toggles on Enter / Space keydown', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = false;
            document.body.appendChild(input);

            const cb = new Checkbox(input);
            const container = (input.nextElementSibling as HTMLDivElement).querySelector('.checkbox-container') as HTMLDivElement;

            container.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
            assert.strictEqual(input.checked, true);

            container.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
            assert.strictEqual(input.checked, false);

            cb.dispose();
        });

        it('removes generated DOM on dispose', function () {
            const input = document.createElement('input');
            input.type = 'checkbox';
            document.body.appendChild(input);

            const cb = new Checkbox(input);
            cb.dispose();

            assert.strictEqual(input.nextElementSibling, null);
        });
    });
});
