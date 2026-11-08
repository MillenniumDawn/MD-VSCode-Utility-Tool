import * as assert from 'assert';
import * as vscode from 'vscode';
import { fileOrUriStringToUri, readDirFiles, readDirFilesRecursively } from '../util/vsccommon';
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

        it('lists a file that is a link, walks through a directory that is one, and omits a bare link', async () => {
            // The provider stats what a link points at, so a linked file answers File|SymbolicLink and
            // a linked directory Directory|SymbolicLink; a link to nothing answers SymbolicLink alone.
            const linkedFile = vscode.FileType.File | vscode.FileType.SymbolicLink;
            const linkedDirectory = vscode.FileType.Directory | vscode.FileType.SymbolicLink;
            const tree: Record<string, [string, number][]> = {
                '/root': [['a.txt', vscode.FileType.File], ['sub', vscode.FileType.Directory], ['l.txt', linkedFile], ['linked', linkedDirectory], ['dangling', vscode.FileType.SymbolicLink]],
                '/root/sub': [['b.txt', vscode.FileType.File]],
                '/root/linked': [['c.txt', linkedFile], ['d.txt', vscode.FileType.File]],
            };
            stubVscode({
                readDirectory: async (uri: vscode.Uri) => {
                    const key = uri.fsPath.replace(/\\/g, '/');
                    return tree[key] ?? [];
                },
            });
            const result = await readDirFilesRecursively(vscode.Uri.file('/root'));
            assert.deepStrictEqual(result, ['a.txt', 'sub/b.txt', 'l.txt', 'linked/c.txt', 'linked/d.txt']);
        });

        it('stops where a linked directory leads back onto one already walked', async () => {
            // `link` resolves onto a directory the walk already holds: readDirectory through it answers
            // with the same listing again, and the entry that resolves back onto the path just
            // descended does so folded short. workspace.fs offers no realpath for a link's target, so
            // the visited set compares the identities the walk descends through, and meeting one it
            // holds is where this finishes instead of turning.
            const tree: Record<string, [string, number][]> = {
                '/root': [['a.txt', vscode.FileType.File], ['link', vscode.FileType.Directory | vscode.FileType.SymbolicLink]],
                '/root/link': [['.', vscode.FileType.Directory | vscode.FileType.SymbolicLink], ['b.txt', vscode.FileType.File]],
            };
            stubVscode({
                readDirectory: async (uri: vscode.Uri) => {
                    const key = uri.fsPath.replace(/\\/g, '/');
                    return tree[key] ?? [];
                },
            });
            const result = await readDirFilesRecursively(vscode.Uri.file('/root'));
            assert.deepStrictEqual(result, ['a.txt', 'link/b.txt']);
        });

        it('finishes when a linked directory lists that same link again', async () => {
            // A provider follows the link and returns the target's names under the link path, so the
            // path never collapses back to the root. The listing naming the link again is the cycle.
            const linkedDirectory = vscode.FileType.Directory | vscode.FileType.SymbolicLink;
            const tree: Record<string, [string, number][]> = {
                '/root': [['a.txt', vscode.FileType.File], ['link', linkedDirectory]],
                '/root/link': [['a.txt', vscode.FileType.File], ['sub', vscode.FileType.Directory], ['link', linkedDirectory]],
                '/root/link/sub': [['b.txt', vscode.FileType.File]],
            };
            stubVscode({
                readDirectory: async (uri: vscode.Uri) => {
                    const key = uri.fsPath.replace(/\\/g, '/');
                    return tree[key] ?? tree['/root/link'];
                },
            });
            const result = await readDirFilesRecursively(vscode.Uri.file('/root'));
            assert.deepStrictEqual(result, ['a.txt', 'link/a.txt', 'link/sub/b.txt']);
        });

        it('does not follow a linked directory out of the tree it is walking', async () => {
            // Walking /root/sub, the link resolves above it into the parent folder: the entry that
            // reaches the walk root from inside the linked directory collapses out of it.
            const tree: Record<string, [string, number][]> = {
                '/root/sub': [['a.txt', vscode.FileType.File], ['out', vscode.FileType.Directory | vscode.FileType.SymbolicLink]],
                '/root/sub/out': [['..', vscode.FileType.Directory | vscode.FileType.SymbolicLink], ['b.txt', vscode.FileType.File]],
            };
            stubVscode({
                readDirectory: async (uri: vscode.Uri) => {
                    const key = uri.fsPath.replace(/\\/g, '/');
                    return tree[key] ?? [];
                },
            });
            const result = await readDirFilesRecursively(vscode.Uri.file('/root/sub'));
            assert.deepStrictEqual(result, ['a.txt', 'out/b.txt']);
        });
    });

    describe('readDirFiles', () => {
        afterEach(() => restoreVscodeStubs());

        it('lists plain files and linked files, and neither directories nor bare links', async () => {
            stubVscode({
                readDirectory: async () => [
                    ['a.txt', vscode.FileType.File],
                    ['l.txt', vscode.FileType.File | vscode.FileType.SymbolicLink],
                    ['sub', vscode.FileType.Directory],
                    ['linked', vscode.FileType.Directory | vscode.FileType.SymbolicLink],
                    ['dangling', vscode.FileType.SymbolicLink],
                ],
            });
            assert.deepStrictEqual(await readDirFiles(vscode.Uri.file('/root')), ['a.txt', 'l.txt']);
        });
    });
});
