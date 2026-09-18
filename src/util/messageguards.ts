// Type guards for what a webview posts back to the extension host. A message is the page's own,
// but it is still input read off a boundary: a field is a number or a string only once one of
// these has said so, and the handlers read nothing they did not check.

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** A document offset: a non-negative integer. */
export function isOffset(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isOptionalOffset(value: unknown): value is number | undefined {
	return value === undefined || isOffset(value);
}

export function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}
