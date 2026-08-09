// js-yaml is required lazily so it isn't loaded at activation; it only loads the first time a YAML
// file is actually parsed (the scan-references command). The 4.x line dropped safeLoad and now
// defaults to a permissive schema (allows !!js/function); pass JSON_SCHEMA explicitly to preserve
// the safe-load semantics the 3.x safeLoad provided.
export function parseYaml(content: string): any {
    const yaml = require('js-yaml');
    try {
        return yaml.load(content, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
        content = content.replace(/:\d+\s*"/g, ": \"").replace(/(?<=")((?:\\.|[^\\"\n\r])*?)"(?!\s*$)/gm, "$1\\\"");
    }

    return yaml.load(content, { schema: yaml.JSON_SCHEMA });
}
