import * as assert from 'assert';
import * as vscode from 'vscode';
import { expiryToken, DlcZip, getFilePathFromModOrHOI4, clearDlcZipCache, parseHoi4FileCached, parseAndResolveHoi4FileCached } from '../util/fileloader';
import { Node, SymbolNode } from '../hoiformat/hoiparser';

// EXPIRY_STAT_TTL in fileloader.ts is 500ms; tests advance the stubbed clock past that.
const TTL = 500;

// The on-disk expiry-token branch stats the file (via getLastModifiedAsync). We replace the
// stub's fs.stat so we can count calls and vary the reported mtime, and we drive Date.now so the
// memo's TTL boundary is deterministic. Opened/dirty documents must never reach the stat, so the
// stat call count is also our proof that they bypass the memo.
describe('util/fileloader expiryToken', function () {
    let statCalls = 0;
    let mtime = 0;
    const realStat = (vscode.workspace.fs as any).stat;
    const realNow = Date.now;

    beforeEach(function () {
        statCalls = 0;
        mtime = 111;
        (vscode.workspace.fs as any).stat = async () => { statCalls++; return { type: vscode.FileType.File, mtime, ctime: 0, size: 0 }; };
    });

    afterEach(function () {
        (vscode.workspace.fs as any).stat = realStat;
        Date.now = realNow;
    });

    function onDiskUri(str: string): vscode.Uri {
        return { fragment: '', path: '/f.txt', scheme: 'file', toString: () => str } as unknown as vscode.Uri;
    }
    function openedUri(str: string): vscode.Uri {
        return { fragment: ':opened', path: '/f.txt', scheme: 'file', toString: () => str } as unknown as vscode.Uri;
    }

    it('returns an empty string for an undefined path', async function () {
        assert.strictEqual(await expiryToken(undefined), '');
    });

    it('memoizes the on-disk stat within the TTL and recomputes after it', async function () {
        Date.now = () => 1000;
        const uri = onDiskUri('file:///disk-a.txt');

        const t1 = await expiryToken(uri);
        const t2 = await expiryToken(uri);

        assert.strictEqual(t1, 'file:///disk-a.txt@111');
        assert.strictEqual(t2, t1);
        assert.strictEqual(statCalls, 1); // second call served from the memo

        Date.now = () => 1000 + TTL + 1;
        mtime = 222;
        const t3 = await expiryToken(uri);

        assert.strictEqual(t3, 'file:///disk-a.txt@222');
        assert.strictEqual(statCalls, 2); // past the TTL it re-stats
    });

    it('always returns a fresh token for opened/dirty documents and never stats them', async function () {
        let clock = 5000;
        Date.now = () => clock;
        const uri = openedUri('file:///doc.txt#opened');

        const a = await expiryToken(uri);
        clock = 5001;
        const b = await expiryToken(uri);

        assert.strictEqual(a, 'file:///doc.txt#opened@5000');
        assert.strictEqual(b, 'file:///doc.txt#opened@5001');
        assert.notStrictEqual(a, b); // the dirty-doc branch is never memoized
        assert.strictEqual(statCalls, 0); // and never touches the stat memo
    });
});

// getFilePathFromModOrHOI4 resolves a relative path against the workspace/HOI4/DLCs with several
// fs.stats per call; a render hits the same paths hundreds of times. A 500ms memo collapses those.
// A workspace folder whose files all exist means one stat resolves the path, so the stat count is
// our proof the resolution ran once within the TTL and again after it. Mirrors the getLastModifiedMemo test above.
describe('util/fileloader getFilePathFromModOrHOI4', function () {
    let statCalls = 0;
    const realStat = (vscode.workspace.fs as any).stat;
    const realNow = Date.now;
    const realFolders = (vscode.workspace as any).workspaceFolders;

    beforeEach(function () {
        statCalls = 0;
        (vscode.workspace.fs as any).stat = async () => { statCalls++; return { type: vscode.FileType.File, mtime: 0, ctime: 0, size: 0 }; };
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: '/ws', path: '/ws', scheme: 'file', toString: () => 'file:///ws' } },
        ];
    });

    afterEach(async function () {
        (vscode.workspace.fs as any).stat = realStat;
        (vscode.workspace as any).workspaceFolders = realFolders;
        Date.now = realNow;
        await clearDlcZipCache(); // drop the path memo so it doesn't leak into other tests
    });

    it('resolves once within the TTL and re-resolves after it expires', async function () {
        Date.now = () => 2000;
        const first = await getFilePathFromModOrHOI4('common/foo.txt');
        const second = await getFilePathFromModOrHOI4('common/foo.txt');

        assert.strictEqual(first!.toString(), 'file:///ws/common/foo.txt');
        assert.strictEqual(second!.toString(), first!.toString());
        assert.strictEqual(statCalls, 1); // second resolution served from the memo

        Date.now = () => 2000 + TTL + 1;
        const third = await getFilePathFromModOrHOI4('common/foo.txt');

        assert.strictEqual(third!.toString(), first!.toString());
        assert.strictEqual(statCalls, 2); // past the TTL it re-resolves
    });
});

// The DLC-zip wrapper indexes a zip's central directory once and answers lookups/listings from
// those maps. These tests pin the normalization it must preserve from the old getEntry/getEntries
// code: exact-name lookup, leading slash/backslash stripping, and skipping directory entries.
describe('util/fileloader DlcZip', function () {
    const AdmZip = require('adm-zip');

    function makeZip(): DlcZip {
        const zip = new AdmZip();
        zip.addFile('gfx/interface/foo.dds', Buffer.from('foo'));
        zip.addFile('gfx/interface/bar.dds', Buffer.from('bar'));
        zip.addFile('/gfx/interface/slashfront.dds', Buffer.from('s')); // leading slash
        zip.addFile('\\gfx/interface/backfront.dds', Buffer.from('b')); // leading backslash
        zip.addFile('gfx/other.dds', Buffer.from('o'));
        zip.addFile('gfx/interface/', Buffer.alloc(0)); // directory entry
        return new DlcZip(() => zip);
    }

    it('looks up an entry by its exact name and returns null otherwise', function () {
        const dlcZip = makeZip();
        assert.strictEqual(dlcZip.getEntry('gfx/interface/foo.dds')!.isDirectory, false);
        assert.strictEqual(dlcZip.getEntry('gfx/interface/missing.dds'), null);
    });

    it('reopens the archive per read and resolves an entry\'s data via getDataAsync', async function () {
        const fakeEntry = { getDataAsync: (cb: (data: Buffer) => void) => cb(Buffer.from('payload')) };
        let opens = 0;
        const dlcZip = new DlcZip(() => {
            opens++;
            return { getEntry: (name: string) => name === 'a/b.dds' ? fakeEntry : null } as any;
        });

        assert.strictEqual((await dlcZip.readEntryData('a/b.dds'))!.toString(), 'payload');
        assert.strictEqual(await dlcZip.readEntryData('a/missing.dds'), null);
        assert.strictEqual(opens, 2); // reopened per read, retaining no buffer
    });

    it('reports a directory entry via isDirectory (the listing guard relies on it)', function () {
        const dir = makeZip().getEntry('gfx/interface/');
        assert.ok(dir);
        assert.strictEqual(dir!.isDirectory, true);
    });

    it('lists file basenames in a directory, stripping leading slash/backslash and skipping directories', function () {
        assert.deepStrictEqual(
            makeZip().listDir('gfx/interface/').sort(),
            ['backfront.dds', 'bar.dds', 'foo.dds', 'slashfront.dds']);
    });

    it('resolves the query path so a trailing slash lists the same directory', function () {
        const dlcZip = makeZip();
        const expected = ['backfront.dds', 'bar.dds', 'foo.dds', 'slashfront.dds'];
        assert.deepStrictEqual(dlcZip.listDir('gfx/interface').sort(), expected);
        assert.deepStrictEqual(dlcZip.listDir('gfx/interface/').sort(), expected);
    });
});

// The parse cache stores the tokenized Node tree so unchanged files aren't re-parsed every render.
// A workspace file (fs.stat says File, no matching open document) is on-disk, so it caches; we stub
// fs.readFile to count reads and return content, and fix Date.now so the cache serves within its
// nonExpireLife window.
describe('util/fileloader parseHoi4FileCached', function () {
    let readCalls = 0;
    let content = '';
    const realStat = (vscode.workspace.fs as any).stat;
    const realReadFile = (vscode.workspace.fs as any).readFile;
    const realNow = Date.now;
    const realFolders = (vscode.workspace as any).workspaceFolders;

    beforeEach(function () {
        readCalls = 0;
        content = 'a = 1\nb = "two"';
        Date.now = () => 4000;
        (vscode.workspace.fs as any).stat = async () => ({ type: vscode.FileType.File, mtime: 111, ctime: 0, size: 0 });
        (vscode.workspace.fs as any).readFile = async () => { readCalls++; return Buffer.from(content); };
        (vscode.workspace as any).workspaceFolders = [
            { uri: { fsPath: '/ws', path: '/ws', scheme: 'file', toString: () => 'file:///ws' } },
        ];
    });

    afterEach(async function () {
        (vscode.workspace.fs as any).stat = realStat;
        (vscode.workspace.fs as any).readFile = realReadFile;
        Date.now = realNow;
        (vscode.workspace as any).workspaceFolders = realFolders;
        await clearDlcZipCache(); // drop the parse/content/path caches so entries don't leak between tests
    });

    function child(node: Node, name: string): Node {
        const found = (node.value as Node[]).find(n => n.name === name);
        assert.ok(found, `expected a child named ${name}`);
        return found!;
    }

    it('parses an unchanged file once across repeated calls (shared cached tree)', async function () {
        const first = await parseHoi4FileCached('common/pc-a.txt');
        const second = await parseHoi4FileCached('common/pc-a.txt');

        assert.strictEqual(second, first); // same Node instance => parsed once, not re-tokenized
        assert.strictEqual(readCalls, 1); // and the buffer was read once
        assert.strictEqual(child(first, 'a').value, 1);
    });

    it('keys the options variant separately from the default parse', async function () {
        const withTokens = await parseHoi4FileCached('common/pc-b.txt');
        const withoutTokens = await parseHoi4FileCached('common/pc-b.txt', { keepTokens: false });

        assert.notStrictEqual(withoutTokens, withTokens); // distinct cache entries
        assert.notStrictEqual(child(withTokens, 'a').nameToken, null); // default keeps position tokens
        assert.strictEqual(child(withoutTokens, 'a').nameToken, null); // keepTokens:false dropped them
    });

    it('resolves script variables without corrupting the plain cache entry', async function () {
        content = '@A = 5\nx = @A';

        const plain = await parseHoi4FileCached('common/pc-c.txt');
        const resolved = await parseAndResolveHoi4FileCached('common/pc-c.txt');

        assert.notStrictEqual(resolved, plain); // resolved variant is its own entry
        assert.strictEqual(child(resolved, 'x').value, 5); // @A substituted in the resolved tree
        assert.strictEqual((child(plain, 'x').value as SymbolNode).name, '@A'); // plain tree still holds the symbol

        const plainAgain = await parseHoi4FileCached('common/pc-c.txt');
        assert.strictEqual(plainAgain, plain); // same cached instance, untouched by the resolve pass
        assert.strictEqual((child(plainAgain, 'x').value as SymbolNode).name, '@A');
    });
});
