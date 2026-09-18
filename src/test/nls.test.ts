import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// The manifest strings VS Code shows for settings and commands come from package.nls.<lang>.json.
// A key missing from a locale file falls back to English silently, which is how the settings
// page ended up half-translated (issue #191). The i18n/ copies are the source webpack copies to
// the root, and both sets are committed, so they have to agree as well.
describe('package.nls parity', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const readJson = (file: string): Record<string, string> =>
        JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

    const base = readJson('package.nls.json');
    const locales = ['en', 'ko', 'ru', 'zh-cn'];

    for (const locale of locales) {
        it(`package.nls.${locale}.json carries every key of package.nls.json and nothing else`, () => {
            const translated = readJson(`package.nls.${locale}.json`);
            assert.deepStrictEqual(Object.keys(translated).sort(), Object.keys(base).sort());
        });

        it(`i18n/package.nls.${locale}.json matches the root copy`, () => {
            assert.deepStrictEqual(
                readJson(path.join('i18n', `package.nls.${locale}.json`)),
                readJson(`package.nls.${locale}.json`),
            );
        });
    }

    it('every %placeholder% in package.json resolves in package.nls.json', () => {
        const manifest = readJson('package.json') as Record<string, unknown>;
        // The npm scripts carry shell variables such as %CERT_PATH%, which are not nls keys.
        delete manifest.scripts;
        const placeholders = new Set(
            [...JSON.stringify(manifest).matchAll(/%([A-Za-z0-9_.]+)%/g)].map(m => m[1]),
        );
        const unresolved = [...placeholders].filter(key => !(key in base)).sort();
        assert.deepStrictEqual(unresolved, []);
    });
});
