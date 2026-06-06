// js-yaml is required lazily so it isn't loaded at activation; it only loads the first time a YAML
// file is actually parsed (the scan-references command).
export function parseYaml(content: string): any {
    const yaml = require('js-yaml');
    try {
        return yaml.safeLoad(content);
    } catch (e) {
        content = content.replace(/:\d+\s*"/g, ": \"").replace(/(?<=")((?:\\.|[^\\"\n\r])*?)"(?!\s*$)/gm, "$1\\\"");
    }

    return yaml.safeLoad(content);
}
