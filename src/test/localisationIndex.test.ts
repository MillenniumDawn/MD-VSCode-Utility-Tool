import * as assert from 'assert';
import * as featureflags from '../util/featureflags';
import {
    parseLocalisation,
    getLocalisedText,
    registerLocalisationIndex,
    __resetLocalisationIndexForTests,
} from '../util/localisationIndex';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

describe('util/localisationIndex', () => {
    describe('parseLocalisation', () => {
        it('parses entries with and without a version number', () => {
            const result = parseLocalisation([
                'l_english:',
                ' KEY_A:0 "value a"',
                ' KEY_B:3 "value b"',
                ' KEY_C: "value c"',
            ].join('\n'));
            assert.deepStrictEqual(result.l_english, {
                KEY_A: 'value a',
                KEY_B: 'value b',
                KEY_C: 'value c',
            });
        });

        it('does not let a malformed entry (missing closing quote) corrupt later entries', () => {
            // Regression for #26: a value with no closing quote used to poison every entry after
            // it in the same file when parsed through js-yaml.
            const result = parseLocalisation([
                'l_russian:',
                ' EYE_ALV_fascism_ADJ:0 "Великозёрск',
                ' EYE_KRV_neutrality:0 "Хестрайская Конфедерация"',
            ].join('\n'));
            assert.strictEqual(result.l_russian.EYE_KRV_neutrality, 'Хестрайская Конфедерация');
            assert.strictEqual(result.l_russian.EYE_ALV_fascism_ADJ, undefined);
        });

        it('preserves quotes embedded inside a value', () => {
            const result = parseLocalisation([
                'l_english:',
                ' KEY:0 "a "b" c"',
            ].join('\n'));
            assert.strictEqual(result.l_english.KEY, 'a "b" c');
        });

        it('ignores comment lines and blank lines', () => {
            const result = parseLocalisation([
                '# a comment',
                'l_english:',
                '',
                '   # indented comment',
                ' KEY:0 "value"',
            ].join('\n'));
            assert.deepStrictEqual(result.l_english, { KEY: 'value' });
        });

        it('does not capture a trailing comment into the value', () => {
            const result = parseLocalisation('l_english:\n KEY:0 "value" # trailing comment');
            assert.strictEqual(result.l_english.KEY, 'value');
        });

        it('switches language buckets on each header', () => {
            const result = parseLocalisation([
                'l_english:',
                ' KEY:0 "english"',
                'l_russian:',
                ' KEY:0 "russian"',
            ].join('\n'));
            assert.strictEqual(result.l_english.KEY, 'english');
            assert.strictEqual(result.l_russian.KEY, 'russian');
        });
    });
});

type FileloaderModule = {
    listFilesFromModOrHOI4: (
        relativePath: string,
        options?: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
    ) => Promise<string[]>;
    readFileFromModOrHOI4: (
        relativePath: string,
        options?: { mod?: boolean; hoi4?: boolean },
    ) => Promise<[Buffer, unknown]>;
};

const fileloader = require('../util/fileloader') as FileloaderModule;

const LOC_FILE_CONTENT = Buffer.from('l_english:\n KEY_A:0 "Value A"\n');

function waitForAsyncTasks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe('util/localisationIndex lazy build', function () {
    let originalListFiles: FileloaderModule['listFilesFromModOrHOI4'];
    let originalReadFile: FileloaderModule['readFileFromModOrHOI4'];
    let listFilesCallCount: number;

    beforeEach(function () {
        __resetLocalisationIndexForTests();
        stubVscode({
            getConfiguration: () => ({ localisationIndex: true }),
        });
        featureflags.refreshFeatureFlags();

        listFilesCallCount = 0;
        originalListFiles = fileloader.listFilesFromModOrHOI4;
        originalReadFile = fileloader.readFileFromModOrHOI4;

        (
            fileloader as typeof fileloader & {
                listFilesFromModOrHOI4: FileloaderModule['listFilesFromModOrHOI4'];
            }
        ).listFilesFromModOrHOI4 = async () => {
            listFilesCallCount++;
            return ['test_l_english.yml'];
        };
        (
            fileloader as typeof fileloader & {
                readFileFromModOrHOI4: FileloaderModule['readFileFromModOrHOI4'];
            }
        ).readFileFromModOrHOI4 = async () => [LOC_FILE_CONTENT, {} as unknown];
    });

    afterEach(function () {
        (
            fileloader as typeof fileloader & {
                listFilesFromModOrHOI4: FileloaderModule['listFilesFromModOrHOI4'];
            }
        ).listFilesFromModOrHOI4 = originalListFiles;
        (
            fileloader as typeof fileloader & {
                readFileFromModOrHOI4: FileloaderModule['readFileFromModOrHOI4'];
            }
        ).readFileFromModOrHOI4 = originalReadFile;
        restoreVscodeStubs();
        featureflags.refreshFeatureFlags();
        __resetLocalisationIndexForTests();
    });

    it('does no build work when registered', async function () {
        const disposable = registerLocalisationIndex();
        await waitForAsyncTasks();

        assert.strictEqual(listFilesCallCount, 0);
        disposable.dispose();
    });

    it('does no build work when the feature flag is off', async function () {
        stubVscode({ getConfiguration: () => ({ localisationIndex: false }) });
        featureflags.refreshFeatureFlags();

        const result = await getLocalisedText('KEY_A', 'en');

        assert.strictEqual(result, 'KEY_A');
        assert.strictEqual(listFilesCallCount, 0);
    });

    it('builds the index exactly once for concurrent first lookups, then serves later lookups from it', async function () {
        const [first, second] = await Promise.all([
            getLocalisedText('KEY_A', 'en'),
            getLocalisedText('KEY_A', 'en'),
        ]);

        // One list call for the global build, one for the workspace build; a duplicate build would double these.
        assert.strictEqual(listFilesCallCount, 2);
        assert.strictEqual(first, 'Value A');
        assert.strictEqual(second, 'Value A');

        const third = await getLocalisedText('KEY_A', 'en');
        assert.strictEqual(third, 'Value A');
        assert.strictEqual(listFilesCallCount, 2);
    });
});
