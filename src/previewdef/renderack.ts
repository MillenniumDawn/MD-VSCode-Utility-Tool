/** Bound a host wait for a webview acknowledgement so a broken page fails the smoke test. */
export function waitForRenderAck(ack: Promise<string[]>, timeoutMs: number): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Webview did not acknowledge rendered DOM within ${timeoutMs} ms`)), timeoutMs);
		ack.then(
			(ids) => {
				clearTimeout(timer);
				resolve(ids);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

