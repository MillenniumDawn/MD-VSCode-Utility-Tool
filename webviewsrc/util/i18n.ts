import { __table } from "../../i18n/en";

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

	if (args.length === 0) {
		return message;
	}
	return message.replace(
		placeholderPattern(args.length),
		(_, group1) => args[parseInt(group1, 10)]?.toString() ?? "",
	);
}

// One pattern per argument count, built on first use, as in the extension host's localize. The
// pattern only names the placeholders that have an argument, so `{1}` with a single argument is
// left in the text as it always was.
const placeholderPatterns: RegExp[] = [];

function placeholderPattern(arity: number): RegExp {
	let pattern = placeholderPatterns[arity];
	if (pattern === undefined) {
		const indexes: string[] = [];
		for (let i = 0; i < arity; i++) {
			indexes.push(i.toString());
		}
		pattern = new RegExp("\\{(" + indexes.join("|") + ")\\}", "g");
		placeholderPatterns[arity] = pattern;
	}
	return pattern;
}
