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

/** Require the browser to report exactly the event IDs that the fixture is meant to render. */
export function assertRenderedIds(actual: readonly string[], expected: readonly string[]): void {
	const actualSorted = [...actual].sort();
	const expectedSorted = [...expected].sort();
	if (actualSorted.length !== expectedSorted.length || actualSorted.some((id, i) => id !== expectedSorted[i])) {
		throw new Error(`Rendered event IDs did not match fixture: expected ${JSON.stringify(expectedSorted)}, received ${JSON.stringify(actualSorted)}`);
	}
}
