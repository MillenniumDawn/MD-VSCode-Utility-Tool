import { localisationIndex } from "../util/featureflags";
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
	const text = localisationIndex ? await getLocalisedTextQuick(key) : key;
	return { key, text: text ?? key };
}

/** The resolved text alone, for the places that show a string rather than build a LocText. */
export async function localiseText(key: string): Promise<string> {
	return (await localise(key)).text;
}
