// Shapes shared by every preview payload.
//
// Like the payload modules that use them, this file is imported by webview bundles, so it must stay
// free of any runtime dependency -- no vscode, no image cache, no localisation index. An accidental
// value import from a webview then fails at build time instead of dragging the extension host into
// the bundle.

// A localisation key together with the text it resolves to. Both travel to the webview so a
// "show localisation" toggle can swap between them without a round trip to the host.
export interface LocText {
	key: string;
	text: string;
}

export interface NavTarget {
	start: number;
	end: number;
	file: string;
}
