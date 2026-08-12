// @ts-nocheck
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Integration smoke', () => {
    test('extension is present', async () => {
        const ext = vscode.extensions.getExtension('MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026');
        assert.ok(ext, 'extension not found');
    });

    test('extension activates and registers commands', async () => {
        const ext = vscode.extensions.getExtension('MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026')!;
        if (!ext.isActive) {
            await ext.activate();
        }
        assert.ok(ext.isActive, 'extension failed to activate');
        const cmds = await vscode.commands.getCommands(true);
        for (const id of ['mdhoi4utilities.preview', 'mdhoi4utilities.previewworld', 'mdhoi4utilities.selectmodfile', 'mdhoi4utilities.selecthoifolder']) {
            assert.ok(cmds.includes(id), `command ${id} not registered`);
        }
    });

    test('custom editors are registered', async () => {
        // VS Code does not expose a direct query for custom editors, but activation without throwing
        // and the extension manifest containing the viewTypes is sufficient smoke. Verify via packageJSON.
        const ext = vscode.extensions.getExtension('MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026')!;
        const manifest: any = ext.packageJSON;
        const viewTypes: string[] = (manifest.contributes?.customEditors ?? []).map((e: any) => e.viewType);
        assert.ok(viewTypes.includes('mdhoi4utilities.dds'), 'dds custom editor not contributed');
        assert.ok(viewTypes.includes('mdhoi4utilities.tga'), 'tga custom editor not contributed');
    });
});
