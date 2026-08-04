import * as assert from 'assert';
import * as vscode from 'vscode';
import { FocusTreeLoader } from '../previewdef/focustree/loader';
import { LoaderSession } from '../util/loader/loader';
import { listGuiGfxFiles, resolveInlayGuiWindows, resolveInlayGfxFiles } from '../previewdef/focustree/inlay';
import { clearDlcZipCache } from '../util/fileloader';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

// Drives FocusTreeLoader.postLoad against a stubbed interface/ tree (two .gfx, one .gui) served from
// the HOI4 install path (no workspace folders). Feature flags are off, so getGfxContainerFiles is a
// no-op and focus icons resolve by scanning result.gfxFiles -- which the short-circuit must keep the
// interface gfx listing in for a no-inlay tree, or focus icons defined outside goals.gfx stop
// resolving. This is the render-safety guarantee the short-circuit rests on.
describe('previewdef/focustree/loader inlay short-circuit', function () {
    const File = vscode.FileType.File;
    const Directory = vscode.FileType.Directory;

    function uriPath(uri: any): string {
        return String(uri.fsPath ?? uri.path ?? '');
    }
    function underInterface(uri: any): boolean {
        return /(^|[/:])interface(\/|$)/.test(uriPath(uri));
    }

    beforeEach(function () {
        stubVscode({
            configuration: { modFile: '', loadDlcContents: false, inlayWindowGfxRoots: [] },
            stat: async (uri: any) => ({
                type: underInterface(uri) && !/\.(gfx|gui)$/.test(uriPath(uri)) ? Directory : File,
                mtime: 1, ctime: 0, size: 0,
            }),
            readDirectory: async (uri: any) =>
                underInterface(uri) ? [['a.gfx', File], ['b.gfx', File], ['c.gui', File]] : [],
        });
    });

    afterEach(async function () {
        restoreVscodeStubs();
        await clearDlcZipCache(); // drop the 3s directory-listing cache so listings don't leak between tests
    });

    function postLoad(content: string): Promise<any> {
        const loader = new FocusTreeLoader('common/national_focus/test_tree.txt');
        return (loader as any).postLoad(content, [], undefined, new LoaderSession(true));
    }

    const noInlayTree = `focus_tree = {
    id = test_no_inlay
    focus = { id = focus_a x = 0 y = 0 }
}`;

    const inlayTree = `focus_tree = {
    id = test_with_inlay
    inlay_window = { id = my_inlay position = { x = 10 y = 20 } }
    focus = { id = focus_b x = 0 y = 0 }
}`;

    it('short-circuits a no-inlay tree: empty inlayWindows, but the interface gfx listing stays in gfxFiles', async function () {
        const result = await postLoad(noInlayTree);
        const trees = result.result.focusTrees;
        assert.strictEqual(trees.length, 1);
        assert.strictEqual(trees[0].inlayWindowRefs.length, 0);
        assert.deepStrictEqual(trees[0].inlayWindows, []);
        assert.deepStrictEqual(trees[0].inlayConditionExprs, []);
        // Render-safety: the focus-icon scan set still contains every interface gfx file.
        assert.ok(result.result.gfxFiles.includes('interface/a.gfx'));
        assert.ok(result.result.gfxFiles.includes('interface/b.gfx'));
        // The inlay pipeline was skipped, so no missing-inlay warning is produced.
        assert.ok(!trees[0].warnings.some((w: any) => w.source === 'my_inlay'));
    });

    it('runs the inlay pipeline for a tree with an inlay ref, keeping the same gfx set', async function () {
        const result = await postLoad(inlayTree);
        const trees = result.result.focusTrees;
        assert.strictEqual(trees.length, 1);
        assert.strictEqual(trees[0].inlayWindowRefs.length, 1);
        assert.deepStrictEqual(trees[0].inlayWindows, []); // unresolved: no inlay window files on disk
        // Proof the pipeline ran (not short-circuited): the unresolved ref produced a warning.
        assert.ok(trees[0].warnings.some((w: any) => w.source === 'my_inlay'));
        assert.ok(result.result.gfxFiles.includes('interface/a.gfx'));
    });

    it('short-circuit reproduces the pipeline gfx set: resolveInlayGuiWindows([]).gfxFiles === listGuiGfxFiles(), resolveInlayGfxFiles([]).resolvedFiles === []', async function () {
        const listed = await listGuiGfxFiles();
        const gui = await resolveInlayGuiWindows([]);
        const gfx = await resolveInlayGfxFiles([]);
        assert.deepStrictEqual(gui.gfxFiles, listed);
        assert.deepStrictEqual(gfx.resolvedFiles, []);
        assert.deepStrictEqual(listed, ['interface/a.gfx', 'interface/b.gfx']);
    });
});
