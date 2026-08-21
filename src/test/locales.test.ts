import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    locales,
    defaultYmlSuffix,
    isoBySettingName,
    ymlSuffixByIso,
    ymlSuffixBySettingName,
    ymlSuffixes,
} from '../util/locales';

describe('util/locales', () => {
    // The setting names are a contract with package.json: a language listed in one and not the
    // other either cannot be chosen or resolves to nothing when it is.
    it('lists exactly the languages the previewLocalisation setting offers', () => {
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
        );
        const property = packageJson.contributes.configuration
            .flatMap((c: any) => Object.entries(c.properties as Record<string, any>))
            .find(([name]: [string, any]) => name === 'mdHoi4Utilities.previewLocalisation');
        assert.ok(property, 'expected mdHoi4Utilities.previewLocalisation in package.json');

        const offered = [...(property[1].enum as string[])].sort();
        const known = locales.map(l => l.settingName).sort();
        assert.deepStrictEqual(known, offered);
    });

    it('defaults to the suffix the setting defaults to', () => {
        assert.strictEqual(ymlSuffixBySettingName['English'], defaultYmlSuffix);
    });

    it('resolves a setting name to a suffix through its ISO code', () => {
        for (const locale of locales) {
            assert.strictEqual(isoBySettingName[locale.settingName], locale.iso);
            assert.strictEqual(ymlSuffixByIso[locale.iso], locale.ymlSuffix);
            // The direct mapping has to agree with going via the ISO code, because it replaced a
            // separate hand-maintained table that did exactly that.
            assert.strictEqual(ymlSuffixBySettingName[locale.settingName], locale.ymlSuffix);
        }
    });

    it('has no duplicate ISO codes or suffixes', () => {
        assert.strictEqual(new Set(locales.map(l => l.iso)).size, locales.length);
        assert.strictEqual(new Set(ymlSuffixes).size, locales.length);
    });

    it('keys ISO codes in lowercase, since lookups lowercase the language', () => {
        for (const locale of locales) {
            assert.strictEqual(locale.iso, locale.iso.toLowerCase());
        }
    });
});
