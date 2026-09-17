// js-yaml is required lazily so it isn't loaded at activation; it only loads the first time a YAML
// file is actually parsed (the scan-references command). The 4.x line dropped safeLoad and now
// defaults to a permissive schema (allows !!js/function); pass JSON_SCHEMA explicitly to preserve
// the safe-load semantics the 3.x safeLoad provided.
export function parseYaml(content: string): unknown {
	const yaml = require("js-yaml");
	let original: unknown;
	try {
		return yaml.load(content, { schema: yaml.JSON_SCHEMA });
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
		return yaml.load(repaired, { schema: yaml.JSON_SCHEMA });
	} catch {
		throw original;
	}
}
