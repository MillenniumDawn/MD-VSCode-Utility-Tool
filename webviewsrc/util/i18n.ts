import { fillPlaceholders } from "../../src/util/common";

let table: Record<string, string> = {};

try {
	table = (window as any)["__i18ntable"];
	if (!table) {
		console.error("Table not filled.");
		table = {};
	}
} catch (e) {
	console.error(e);
}

export function feLocalize(
	key: string,
	message: string,
	...args: any[]
): string {
	if (key in table) {
		const localized = table[key];
		if (localized !== undefined) {
			message = localized;
		}
	}
	return fillPlaceholders(message, args);
}
