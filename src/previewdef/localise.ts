import { getFlags } from "../util/featureflags";
import { getLocalisedTextQuick } from "../util/localisationIndex";
import { LocText } from "./sharedpayload";

/*
 * Resolving a localisation key for a preview payload.
 *
 * The decision graph, the event graph and the idea payload builder each carried a byte-identical
 * copy of this, and ten more places wrote the same `localisationIndex ? await ... : key` inline.
 *
 * This lives here rather than in sharedpayload.ts, which holds LocText: that file is bundled into
 * the webviews and has to stay free of any runtime dependency, and this one reaches the extension
 * host's localisation index.
 */
export async function localise(key: string): Promise<LocText> {
	// getLocalisedTextQuick echoes the key back when nothing resolves, which is exactly the fallback
	// the preview wants, so an unresolved key simply reads the same either way.
	const text = getFlags().localisationIndex ? await getLocalisedTextQuick(key) : key;
	return { key, text: text ?? key };
}

export async function localiseLabel(key: string, order: "key-first" | "text-first"): Promise<string> {
	if (!getFlags().localisationIndex) {
		return key;
	}
	const text = await getLocalisedTextQuick(key);
	return order === "key-first" ? `(${key}) ${text}` : `${text} (${key})`;
}

export async function localiseOptionalText(key: string, prefix = ""): Promise<string> {
	return getFlags().localisationIndex ? prefix + ((await getLocalisedTextQuick(key)) ?? "") : "";
}
