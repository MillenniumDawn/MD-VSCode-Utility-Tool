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

        it('leaves braces alone when there are no args', function () {
            assert.strictEqual(feLocalize('nonexistent.key' as any, 'a {} b {0}'), 'a {} b {0}');
        });

        it('substitutes correctly when the argument count changes between calls', function () {
            const key = 'nonexistent.key' as any;
            assert.strictEqual(feLocalize(key, '{0} {1}', 'a', 'b'), 'a b');
            assert.strictEqual(feLocalize(key, '{0} {1}', 'c'), 'c {1}');
            assert.strictEqual(feLocalize(key, '{1} {0} {1}', 'd', 'e'), 'e d e');
            assert.strictEqual(feLocalize(key, '{0} {1}', 'f', 'g'), 'f g');
        });
    });
});
