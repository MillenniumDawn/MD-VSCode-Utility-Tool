import * as assert from 'assert';
import { assertRenderedIds, waitForRenderAck } from '../previewdef/renderack';

describe('browser smoke render acknowledgement', () => {
	it('fails within the bound when the webview never acknowledges its DOM', async () => {
		await assert.rejects(
			waitForRenderAck(new Promise<string[]>(() => undefined), 5),
			/Webview did not acknowledge rendered DOM within 5 ms/,
		);
	});

	it('rejects empty and wrong rendered event IDs', () => {
		assert.throws(() => assertRenderedIds([], ['browser_smoke.1']), /did not match fixture/);
		assert.throws(() => assertRenderedIds(['browser_smoke.2'], ['browser_smoke.1']), /did not match fixture/);
		assert.doesNotThrow(() => assertRenderedIds(['browser_smoke.1'], ['browser_smoke.1']));
	});
});
