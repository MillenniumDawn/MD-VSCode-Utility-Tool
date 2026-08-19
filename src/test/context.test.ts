import * as assert from 'assert';
import * as context from '../context';

describe('context', () => {
    afterEach(() => {
        context.contextContainer.current = null;
        context.contextContainer.contextValue = {};
    });

    describe('registerContextContainer', () => {
        it('sets contextContainer.current to the given context', () => {
            const fakeContext = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
            context.registerContextContainer(fakeContext);

            assert.strictEqual(context.contextContainer.current, fakeContext);
        });

        it('returns a disposable that resets contextContainer.current to null', () => {
            const fakeContext = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
            const disposable = context.registerContextContainer(fakeContext);

            disposable.dispose();

            assert.strictEqual(context.contextContainer.current, null);
        });
    });

    describe('setVscodeContext', () => {
        it('records the key/value on contextContainer.contextValue', () => {
            context.setVscodeContext('someKey', 'someValue');

            assert.strictEqual(context.contextContainer.contextValue.someKey, 'someValue');
        });
    });
});
