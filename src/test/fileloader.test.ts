import * as assert from 'assert';
import * as vscode from 'vscode';
import { expiryToken, DlcZip } from '../util/fileloader';

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
        return new DlcZip(zip);
    }

    it('looks up an entry by its exact name and returns null otherwise', function () {
        const dlcZip = makeZip();
        assert.strictEqual(dlcZip.getEntry('gfx/interface/foo.dds')!.entryName, 'gfx/interface/foo.dds');
        assert.strictEqual(dlcZip.getEntry('gfx/interface/missing.dds'), null);
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
