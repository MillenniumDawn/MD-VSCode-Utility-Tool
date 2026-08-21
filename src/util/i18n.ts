import { error } from "./debug";
import { jsonForScript } from "./common";
import { __table } from "../../i18n/en";

let table: Record<string, string> = {};

export function loadI18n(locale?: string) {
	const config = JSON.parse(process.env.VSCODE_NLS_CONFIG || "{}") as {
		locale: string;
	};
	locale = locale ?? config.locale ?? "en";
	const splitLocale = locale.split("-");

	table =
		tryLoadTable(locale) ??
		(splitLocale.length > 1 && splitLocale[0] !== undefined
			? tryLoadTable(splitLocale[0])
			: undefined) ??
		{};
}

function tryLoadTable(locale: string): Record<string, string> | undefined {
	try {
		// require.context is a webpack-only API. The build step replaces this call, but plain
		// tsc + Node don't know about it, so cast through unknown to keep the type checker
		// happy. The whole expression is wrapped in try/catch and never invoked at test time.
		const requireContext = (
			require as unknown as {
				context(
					directory: string,
					recursive: boolean,
					regex: RegExp,
				): (request: string) => { default: unknown };
			}
		).context("../../i18n", false, /\/(?!template)[\w-]*\.ts$/);
		return requireContext("./" + locale + ".ts").default as Record<
			string,
			string
		>;
	} catch (e) {
		error(e);
	}
	return undefined;
}

export function localize(
	// No "TODO" escape hatch: it widened the key type so a message could be written without adding
	// it to the tables, and six of them were. `key in table` was then always false for those, so
	// they could never be translated and no tooling noticed.
	key: keyof typeof __table,
	message: string,
	...args: any[]
): string {
	if (key in table) {
		message = table[key] ?? message;
	}

	const regex = new RegExp(
		"\\{(" + args.map((_, i) => i.toString()).join("|") + ")\\}",
		"g",
	);
	return message.replace(
		regex,
		(_, group1) => args[parseInt(group1)]?.toString() ?? "",
	);
}

export function localizeText(text: string): string {
	return text.replace(/%(.*?)(?:\|(.*?))?%/g, (substr, key, message) => {
		if (substr === "%%") {
			return "%";
		}

		if (!key) {
			return substr;
		}

		if (!message) {
			message = key;
		}

		return localize(key, message);
	});
}

export function i18nTableAsScript(): string {
	return "window.__i18ntable = " + jsonForScript(table) + ";";
}
