import * as assert from 'assert';
import { fileOrUriStringToUri } from '../util/vsccommon';

describe('util/vsccommon', () => {
    describe('fileOrUriStringToUri', () => {
        it('strips a matched pair of surrounding double quotes', () => {
            assert.strictEqual(fileOrUriStringToUri('"C:\\Program Files\\Hearts of Iron IV"')?.fsPath, 'C:\\Program Files\\Hearts of Iron IV');
        });

        it('strips a matched pair of surrounding single quotes', () => {
            assert.strictEqual(fileOrUriStringToUri("'C:\\HOI4'")?.fsPath, 'C:\\HOI4');
        });

        it('trims surrounding whitespace, inside and outside the quotes', () => {
            assert.strictEqual(fileOrUriStringToUri('  C:\\HOI4  ')?.fsPath, 'C:\\HOI4');
            assert.strictEqual(fileOrUriStringToUri('  " C:\\HOI4 "  ')?.fsPath, 'C:\\HOI4');
        });

        it('leaves an unmatched quote alone rather than guessing', () => {
            assert.strictEqual(fileOrUriStringToUri('"C:\\HOI4')?.fsPath, '"C:\\HOI4');
        });

        it('keeps quotes that are part of the path itself', () => {
            assert.strictEqual(fileOrUriStringToUri('C:\\HOI"4')?.fsPath, 'C:\\HOI"4');
        });

        it('returns undefined when the setting is absent', () => {
            assert.strictEqual(fileOrUriStringToUri(undefined), undefined);
        });

        it('returns undefined for a value that normalizes to nothing', () => {
            assert.strictEqual(fileOrUriStringToUri(''), undefined);
            assert.strictEqual(fileOrUriStringToUri('   '), undefined);
            assert.strictEqual(fileOrUriStringToUri('""'), undefined);
            assert.strictEqual(fileOrUriStringToUri("''"), undefined);
        });

        it('treats a UNC path as a file path', () => {
            assert.strictEqual(fileOrUriStringToUri('"\\\\server\\share\\HOI4"')?.fsPath, '\\\\server\\share\\HOI4');
        });

        it('treats a posix path as a file path', () => {
            assert.strictEqual(fileOrUriStringToUri('"/opt/HOI4"')?.fsPath, '/opt/HOI4');
        });

        it('parses a value that carries a scheme, quotes stripped first', () => {
            assert.strictEqual(fileOrUriStringToUri('"vscode-vfs://github/org/repo"')?.toString(), 'vscode-vfs://github/org/repo');
        });
    });
});
