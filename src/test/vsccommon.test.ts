import * as assert from 'assert';
import * as vscode from 'vscode';
import { fileOrUriStringToUri, readDirFilesRecursively } from '../util/vsccommon';
import { restoreVscodeStubs, stubVscode } from './_vscode_stub';

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

    describe('readDirFilesRecursively', () => {
        afterEach(() => restoreVscodeStubs());

        // Directories are read several at a time; the listing order must not follow completion order.
        function stubTree(delays: Record<string, number> = {}) {
            const tree: Record<string, [string, number][]> = {
                '/root': [['a.txt', vscode.FileType.File], ['sub', vscode.FileType.Directory], ['b.txt', vscode.FileType.File], ['other', vscode.FileType.Directory], ['link', vscode.FileType.SymbolicLink]],
                '/root/sub': [['c.txt', vscode.FileType.File], ['deep', vscode.FileType.Directory]],
                '/root/sub/deep': [['d.txt', vscode.FileType.File]],
                '/root/other': [['e.txt', vscode.FileType.File]],
            };
            stubVscode({
                readDirectory: async (uri: vscode.Uri) => {
                    const key = uri.fsPath.replace(/\\/g, '/');
                    const delay = delays[key];
                    if (delay !== undefined) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    return tree[key] ?? [];
                },
            });
        }

        it('lists files in directory order, descending into subdirectories where they are listed', async () => {
            stubTree();
            const result = await readDirFilesRecursively(vscode.Uri.file('/root'));
            assert.deepStrictEqual(result, ['a.txt', 'sub/c.txt', 'sub/deep/d.txt', 'b.txt', 'other/e.txt']);
        });

        it('keeps that order when an earlier directory answers after a later one', async () => {
            stubTree({ '/root/sub': 20, '/root/sub/deep': 10 });
            const result = await readDirFilesRecursively(vscode.Uri.file('/root'));
            assert.deepStrictEqual(result, ['a.txt', 'sub/c.txt', 'sub/deep/d.txt', 'b.txt', 'other/e.txt']);
        });
    });
});
