import * as assert from 'assert';
import * as featureflags from '../util/featureflags';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

describe('util/featureflags', () => {
    // The stub's `vscode.workspace.getConfiguration` is a single function that returns a fixed
    // object literal. Point it at a local object each test can rewrite, so refreshFeatureFlags
    // re-reads values we control.
    let config: Record<string, unknown> = {};

    beforeEach(() => {
        stubVscode({ getConfiguration: () => config });
    });

    afterEach(() => {
        restoreVscodeStubs();
        config = {};
    });

    describe('refreshFeatureFlags', () => {
        it('copies the new config values onto the live let-bindings', () => {
            config = {
                useConditionInFocus: true,
                eventTreePreview: true,
                sharedFocusIndex: true,
                gfxIndex: true,
                localisationIndex: true,
            };
            featureflags.refreshFeatureFlags();

            assert.strictEqual(featureflags.useConditionInFocus, true);
            assert.strictEqual(featureflags.eventTreePreview, true);
            assert.strictEqual(featureflags.sharedFocusIndex, true);
            assert.strictEqual(featureflags.gfxIndex, true);
            assert.strictEqual(featureflags.localisationIndex, true);
        });

        it('reflects a subsequent change after a second refresh', () => {
            config = { useConditionInFocus: true, sharedFocusIndex: true };
            featureflags.refreshFeatureFlags();
            assert.strictEqual(featureflags.useConditionInFocus, true);
            assert.strictEqual(featureflags.sharedFocusIndex, true);

            config = { useConditionInFocus: false, sharedFocusIndex: false };
            featureflags.refreshFeatureFlags();
            assert.strictEqual(featureflags.useConditionInFocus, false);
            assert.strictEqual(featureflags.sharedFocusIndex, false);
        });

        it('leaves flags undefined when the config does not include them', () => {
            config = {};
            featureflags.refreshFeatureFlags();
            assert.strictEqual(featureflags.useConditionInFocus, undefined);
            assert.strictEqual(featureflags.eventTreePreview, undefined);
        });
    });

    describe('registerFeatureFlags', () => {
        // Capture the change handler registerFeatureFlags subscribes, so a synthetic
        // configuration-change event can drive the affectsConfiguration gate. The outer suite's
        // afterEach restores it along with everything else.
        let firedHandler: ((e: { affectsConfiguration(key: string): boolean }) => void) | undefined;

        beforeEach(() => {
            firedHandler = undefined;
            stubVscode({
                onDidChangeConfiguration: (handler: any) => {
                    firedHandler = handler;
                    return { dispose: () => undefined };
                },
            });
        });

        it('refreshes flags when a change affecting the extension config fires', () => {
            const disp = featureflags.registerFeatureFlags();
            config = { useConditionInFocus: true };
            firedHandler!({ affectsConfiguration: () => true });

            assert.strictEqual(featureflags.useConditionInFocus, true);
            disp.dispose();
        });

        it('ignores changes that do not affect the extension config', () => {
            featureflags.registerFeatureFlags();
            config = { useConditionInFocus: true };
            featureflags.refreshFeatureFlags();

            config = { useConditionInFocus: false };
            firedHandler!({ affectsConfiguration: () => false });

            assert.strictEqual(featureflags.useConditionInFocus, true);
        });

        it('returns a Disposable', () => {
            const disp = featureflags.registerFeatureFlags();
            assert.strictEqual(typeof disp.dispose, 'function');
            disp.dispose();
        });
    });
});
