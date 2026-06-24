import * as assert from 'assert';
import * as vscode from 'vscode';
import * as featureflags from '../util/featureflags';

describe('util/featureflags', () => {
    // The stub's `vscode.workspace.getConfiguration` is a single function that returns a fixed
    // object literal. Replace it for the duration of each test so refreshFeatureFlags re-reads
    // values we control, then restore the original to keep test isolation.
    const originalGetConfiguration = (vscode.workspace as any).getConfiguration;
    let config: Record<string, unknown> = {};

    beforeEach(() => {
        (vscode.workspace as any).getConfiguration = () => config;
    });

    afterEach(() => {
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;
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
        it('returns a Disposable that has a dispose function', () => {
            const disp = featureflags.registerFeatureFlags();
            try {
                assert.strictEqual(typeof disp.dispose, 'function');
            } finally {
                disp.dispose();
            }
        });
    });
});
