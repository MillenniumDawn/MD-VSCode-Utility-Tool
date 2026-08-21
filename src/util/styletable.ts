export class StyleTable {
    private readonly records: Record<string, string> = {};
    private readonly rawRecords: Record<string, string> = {};
    private id: number = 0;
    private cachedCss: string | undefined = undefined;

    // The third argument is the pseudo-class the rule hangs off (':hover', ':focus'). It is part of
    // the record key, so the same name can carry a base rule and its pseudo-class variants.
    public style(name: string, callback: () => string, pseudoClass?: string): string
    public style(name: string, callback: () => Promise<string>, pseudoClass?: string): Promise<string>
    public style(name: string, callback: (() => string) | (() => Promise<string>), pseudoClass: string = ''): string | Promise<string> {
        name = this.name(name);
        const key = name + pseudoClass;
        const result = this.records[key];
        if (result !== undefined) {
            return name;
        }
    
        const callbackResult = callback();
        if (typeof callbackResult === 'string') {
            this.records[key] = callbackResult;
            this.cachedCss = undefined;
            return name;
        } else {
            return callbackResult.then<string>(v => {
                this.records[key] = v;
                this.cachedCss = undefined;
                return name;
            });
        }
    }

    public oneTimeStyle(name: string, callback: () => string, pseudoClass?: string): string
    public oneTimeStyle(name: string, callback: () => Promise<string>, pseudoClass?: string): Promise<string>
    public oneTimeStyle(name: string, callback: (() => string) | (() => Promise<string>), pseudoClass: string = ''): string | Promise<string> {
        const sid = this.id++;
        return this.style(name + '-' + sid, callback as any, pseudoClass);
    }

    public toStyleElement(nonce: string): string {
        return `<style nonce="${nonce}">
            ${this.toRawCss()}
            </style>`;
    }

    /**
     * The accumulated CSS rules without the surrounding `<style>` wrapper. Used to stream style
     * updates into a pre-existing, CSP-nonced `<style>` element in the webview (e.g. progressive
     * focus-icon backgrounds), where re-emitting a `<style nonce>` tag would be blocked by CSP.
     */
    public toRawCss(): string {
        // Every content builder asks for this twice -- once for the <style> block and once for the
        // in-place update's styleCss -- and building it walks every rule with a multiline regex. A
        // tech tree mints a unique class per grid item and per connection segment, so that is well
        // over ten thousand rules to walk, twice, for an identical answer.
        if (this.cachedCss === undefined) {
            this.cachedCss =
                Object.entries(this.records).map(([k, v]) => `.${k} { ${v.replace(/^\s+/gm, '')} }\n`).join('') +
                Object.entries(this.rawRecords).map(([k, v]) => `${k} { ${v.replace(/^\s+/gm, '')} }\n`).join('');
        }

        return this.cachedCss;
    }

    public name(name: string) {
        return 'st-' + name;
    }

    public raw(selector: string, content: string) {
        this.rawRecords[selector] = content;
        this.cachedCss = undefined;
    }
}

export function normalizeForStyle(name: string): string {
    return name.replace(/[^\w_]/g, r => '_' + r.charCodeAt(0));
}
