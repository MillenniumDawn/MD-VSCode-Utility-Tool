import './setup';
import * as assert from 'assert';
import { feLocalize } from '../../../webviewsrc/util/i18n';

describe('webview/util/i18n', function () {
    describe('feLocalize', function () {
        it('replaces arguments in the message', function () {
            const result = feLocalize('combobox.multiple', '{0} (+{1})', 'Alpha', 3);
            assert.strictEqual(result, 'Alpha (+3)');
        });

        it('returns table value when key is in table', function () {
            const result = feLocalize('combobox.noselection' as any, 'unused default');
            assert.strictEqual(result, '(No selection)');
        });

        it('uses default message when key is absent', function () {
            const result = feLocalize('nonexistent.key' as any, 'Default fallback');
            assert.strictEqual(result, 'Default fallback');
        });

        it('handles no arguments', function () {
            const result = feLocalize('test.key', 'Fallback');
            assert.strictEqual(result, 'Translated value');
        });
    });
});
