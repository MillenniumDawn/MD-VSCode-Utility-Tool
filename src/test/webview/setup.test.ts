import { takeRuntimeErrors } from './setup';
import * as assert from 'assert';

// The root hooks in ./setup only fail a test over a thrown listener if jsdom reports it under the name
// setup listens for. A jsdom upgrade that renamed it would switch the check off without a sound.
describe('webview test setup', function () {
    it('records an exception a window listener throws', function () {
        const listener = () => { throw new Error('listener fail'); };
        const originalConsoleError = console.error;
        console.error = () => undefined;
        window.addEventListener('setup-test', listener);
        try {
            window.dispatchEvent(new Event('setup-test'));
        } finally {
            window.removeEventListener('setup-test', listener);
            console.error = originalConsoleError;
        }

        assert.deepStrictEqual(takeRuntimeErrors().map(e => (e as Error).message), ['listener fail']);
    });
});
