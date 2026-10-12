import { Node, parseHoi4File } from "../../hoiformat/hoiparser";

// Game script as an index build reads it: without editor positions, so nodes compare by content.
export function parse(source: string): Node {
	return parseHoi4File(source, "", { keepTokens: false });
}

export function children(source: string): Node[] {
	return parse(source).value as Node[];
}

// Every field name a schema declares, at any depth. The converter lower-cases the names it reads
// from a file before looking them up, so a field declared with a capital can never be filled.
export function schemaKeys(schema: unknown, seen = new Set<unknown>()): string[] {
	if (typeof schema !== "object" || schema === null || seen.has(schema)) {
		return [];
	}
	seen.add(schema);
	const fields = schema as Record<string, unknown>;
	if (typeof fields._type === "string") {
		return schemaKeys(fields._innerType, seen);
	}
	return Object.entries(fields).flatMap(([key, field]) => [key, ...schemaKeys(field, seen)]);
}

export function first(source: string): Node {
	const node = children(source)[0];
	if (node === undefined) {
		throw new Error(`nothing parsed from: ${source}`);
	}
	return node;
}
