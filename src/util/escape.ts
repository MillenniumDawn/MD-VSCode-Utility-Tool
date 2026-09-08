// Escaping for mod-supplied text and identifiers that reach preview HTML. Kept out of html.ts
// because that module imports `vscode`, while the grid-box renderer that needs escapeAttr is
// bundled into the webview as well as the extension host.

// One pass with a lookup table rather than a chain of seven .replace() calls, each of which
// scanned the whole string and built another one. Escaping the ampersand first mattered when the
// replacements ran in sequence -- otherwise a '<' turned into '&lt;' and its '&' was then escaped
// again -- and a single pass removes the ordering hazard along with the six extra scans.
const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
    "\n": "&#10;",
    " ": "&nbsp;",
};
const htmlEscapePattern = /[&<>"'\n ]/g;

export function htmlEscape(unsafe: string): string {
    return unsafe.replace(htmlEscapePattern, c => htmlEscapes[c] as string);
}

// Attribute-context escape for mod-supplied identifiers in preview HTML. Unlike
// htmlEscape it leaves spaces intact so in-page filter / id matching keeps
// working, while still neutralising a "-breakout from a crafted identifier.
// Centralised here so every contentbuilder shares the same escaping.
const attrEscapePattern = /[&"<>]/g;

export function escapeAttr(value: string): string {
    return value.replace(attrEscapePattern, c => htmlEscapes[c] as string);
}
