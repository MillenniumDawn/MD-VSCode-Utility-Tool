// js-yaml is required lazily so it isn't loaded at activation; it only loads the first time a YAML
// file is actually parsed (the scan-references command). The 4.x line dropped safeLoad and now
// defaults to a permissive schema (allows !!js/function); pass JSON_SCHEMA explicitly to preserve
// the safe-load semantics the 3.x safeLoad provided.
export function parseYaml(content: string): unknown {
	const yaml = require("js-yaml");
	let original: unknown;
	try {
		return loadDocument(yaml, content);
	} catch (e) {
		original = e;
	}

	// Best-effort repair of the loose quoting HOI4 localisation files use. The repaired text is
	// only ever used when it parses: an error from it would point at lines that no longer match
	// the user's file, so the original error is the one reported.
	const repaired = content
		.replace(/:\d+\s*"/g, ': "')
		.replace(/(?<=")((?:\\.|[^\\"\n\r])*?)"(?!\s*$)/gm, '$1\\"');
	try {
		return loadDocument(yaml, repaired);
	} catch {
		throw original;
	}
}

// js-yaml 5 rejects input with no document (empty, or comments only) where 4.x returned undefined;
// loadAll gives [] for that. More than one document is still an error, as with load().
function loadDocument(yaml: typeof import("js-yaml"), text: string): unknown {
	const docs: unknown[] = yaml.loadAll(text, { schema: yaml.JSON_SCHEMA });
	if (docs.length > 1) {
		throw new yaml.YAMLException("expected a single document in the stream, but found more than one");
	}
	return docs[0];
}
