function assertRenderedFocusIds(renderedFocusIds, expectedFocusIds) {
	if (!Array.isArray(renderedFocusIds) || renderedFocusIds.length === 0) {
		throw new Error("The focus-tree webview did not acknowledge any mounted focus elements.");
	}
	if (!renderedFocusIds.every((id) => typeof id === "string" && id.length > 0)) {
		throw new Error("The focus-tree webview acknowledgement contained invalid focus ids.");
	}

	const rendered = [...renderedFocusIds].sort();
	const expected = [...expectedFocusIds].sort();
	if (JSON.stringify(rendered) !== JSON.stringify(expected)) {
		throw new Error(
			`The focus-tree webview rendered [${rendered.join(", ")}], expected [${expected.join(", ")}].`,
		);
	}
	return renderedFocusIds;
}

module.exports = { assertRenderedFocusIds };
