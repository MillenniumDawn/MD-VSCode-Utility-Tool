import * as assert from 'assert';
import { localize, localizeText, loadI18n } from '../util/i18n';

describe('util/i18n', () => {
    describe('localize', () => {
        it('returns the message unchanged when it has no placeholders', () => {
            assert.strictEqual(localize('TODO', 'plain message'), 'plain message');
        });

        it('substitutes positional placeholders with stringified args', () => {
            assert.strictEqual(localize('TODO', '{0} loves {1}', 'cats', 7), 'cats loves 7');
        });

        it('only substitutes placeholders that have a matching arg', () => {
            // The replace regex is built from the provided args, so {1} is left intact.
            assert.strictEqual(localize('TODO', '{0} and {1}', 'only'), 'only and {1}');
        });

        it('reuses an arg referenced by multiple placeholders', () => {
            assert.strictEqual(localize('TODO', '{0}-{0}', 'x'), 'x-x');
        });
    });

    describe('localizeText', () => {
        it('replaces %key|message% with the localized message', () => {
            assert.strictEqual(localizeText('a %k|hello% b'), 'a hello b');
        });

        it('uses the key as the message when only %key% is given', () => {
            assert.strictEqual(localizeText('%world%'), 'world');
        });

        it('unescapes %% to a single percent sign', () => {
            assert.strictEqual(localizeText('100%%'), '100%');
        });

        it('leaves text without markers untouched', () => {
            assert.strictEqual(localizeText('nothing to do'), 'nothing to do');
        });
    });

    describe('loadI18n', () => {
        it('falls back to an empty table under plain Node (no webpack require.context)', () => {
            const originalError = console.error;
            console.error = () => undefined; // require.context throws here; swallow the logged error
            try {
                assert.doesNotThrow(() => loadI18n('en'));
            } finally {
                console.error = originalError;
            }
            // With an empty table, localize falls back to the literal message.
            assert.strictEqual(localize('TODO', 'fallback'), 'fallback');
        });
    });
});
