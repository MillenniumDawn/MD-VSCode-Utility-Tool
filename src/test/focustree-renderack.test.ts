import * as assert from 'assert';
import { acknowledgeFocusTreeDomRender, cancelFocusTreeDomRenderWait, hasPendingFocusTreeDomRender, waitForFocusTreeDomRender } from '../previewdef/focustree/renderack';

const { assertRenderedFocusIds } = require('../../../scripts/web-smoke-test') as {
	assertRenderedFocusIds(renderedFocusIds: unknown, expectedFocusIds: string[]): string[];
};

describe('focus-tree webview DOM render acknowledgement', () => {
	it('does not request rendered ids without an active smoke waiter', () => {
		assert.strictEqual(hasPendingFocusTreeDomRender('file:///workspace/ordinary-preview.txt'), false);
	});

	it('returns the ids sent by the webview', async () => {
		const pending = waitForFocusTreeDomRender('file:///workspace/focus.txt', 100);
		assert.strictEqual(hasPendingFocusTreeDomRender('file:///workspace/focus.txt'), true);
		acknowledgeFocusTreeDomRender('file:///workspace/focus.txt', ['web_smoke_focus']);
		assert.deepStrictEqual(await pending, ['web_smoke_focus']);
		assert.strictEqual(hasPendingFocusTreeDomRender('file:///workspace/focus.txt'), false);
	});

	it('replaces an older waiter for the same preview and resolves only the newer request', async () => {
		const uri = 'file:///workspace/replaced.txt';
		const older = waitForFocusTreeDomRender(uri, 1000);
		const newer = waitForFocusTreeDomRender(uri, 1000);

		await assert.rejects(older, /A newer focus-tree DOM render acknowledgement was requested/);
		acknowledgeFocusTreeDomRender(uri, ['web_smoke_focus']);
		assert.deepStrictEqual(await newer, ['web_smoke_focus']);
	});

	it('ignores an acknowledgement after its waiter has been cleared', () => {
		assert.doesNotThrow(() => acknowledgeFocusTreeDomRender('file:///workspace/closed.txt', ['web_smoke_focus']));
	});

	it('fails when the webview never acknowledges a mounted DOM', async () => {
		await assert.rejects(
			waitForFocusTreeDomRender('file:///workspace/no-ack.txt', 5),
			/Timed out waiting for the focus-tree webview DOM render acknowledgement/,
		);
	});

	it('cancels and clears a pending acknowledgement waiter', async () => {
		const uri = 'file:///workspace/cancelled.txt';
		const pending = waitForFocusTreeDomRender(uri, 1000);
		assert.strictEqual(hasPendingFocusTreeDomRender(uri), true);
		assert.strictEqual(cancelFocusTreeDomRenderWait(uri), true);
		assert.strictEqual(hasPendingFocusTreeDomRender(uri), false);
		await assert.rejects(pending, /Cancelled the focus-tree webview DOM render acknowledgement/);
		assert.strictEqual(cancelFocusTreeDomRenderWait(uri), false);
	});

	it('rejects empty, missing, and wrong fixture ids', () => {
		for (const rendered of [undefined, [], ['different_focus']]) {
			assert.throws(
				() => assertRenderedFocusIds(rendered, ['web_smoke_focus']),
				/The focus-tree webview/,
			);
		}
		assert.deepStrictEqual(assertRenderedFocusIds(['web_smoke_focus'], ['web_smoke_focus']), ['web_smoke_focus']);
	});
});
