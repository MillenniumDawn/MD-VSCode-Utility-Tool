import * as assert from 'assert';
import { parseLocalisation } from '../util/localisationIndex';

describe('util/localisationIndex', () => {
    describe('parseLocalisation', () => {
        it('parses entries with and without a version number', () => {
            const result = parseLocalisation([
                'l_english:',
                ' KEY_A:0 "value a"',
                ' KEY_B:3 "value b"',
                ' KEY_C: "value c"',
            ].join('\n'));
            assert.deepStrictEqual(result.l_english, {
                KEY_A: 'value a',
                KEY_B: 'value b',
                KEY_C: 'value c',
            });
        });

        it('does not let a malformed entry (missing closing quote) corrupt later entries', () => {
            // Regression for #26: a value with no closing quote used to poison every entry after
            // it in the same file when parsed through js-yaml.
            const result = parseLocalisation([
                'l_russian:',
                ' EYE_ALV_fascism_ADJ:0 "Великозёрск',
                ' EYE_KRV_neutrality:0 "Хестрайская Конфедерация"',
            ].join('\n'));
            assert.strictEqual(result.l_russian.EYE_KRV_neutrality, 'Хестрайская Конфедерация');
            assert.strictEqual(result.l_russian.EYE_ALV_fascism_ADJ, undefined);
        });

        it('preserves quotes embedded inside a value', () => {
            const result = parseLocalisation([
                'l_english:',
                ' KEY:0 "a "b" c"',
            ].join('\n'));
            assert.strictEqual(result.l_english.KEY, 'a "b" c');
        });

        it('ignores comment lines and blank lines', () => {
            const result = parseLocalisation([
                '# a comment',
                'l_english:',
                '',
                '   # indented comment',
                ' KEY:0 "value"',
            ].join('\n'));
            assert.deepStrictEqual(result.l_english, { KEY: 'value' });
        });

        it('does not capture a trailing comment into the value', () => {
            const result = parseLocalisation('l_english:\n KEY:0 "value" # trailing comment');
            assert.strictEqual(result.l_english.KEY, 'value');
        });

        it('switches language buckets on each header', () => {
            const result = parseLocalisation([
                'l_english:',
                ' KEY:0 "english"',
                'l_russian:',
                ' KEY:0 "russian"',
            ].join('\n'));
            assert.strictEqual(result.l_english.KEY, 'english');
            assert.strictEqual(result.l_russian.KEY, 'russian');
        });
    });
});
