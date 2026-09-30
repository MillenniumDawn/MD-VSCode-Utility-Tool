import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ModToolPack } from '../modtools/api';
import { modToolPacks } from '../modtools/registry';
import { findRepoRoot } from './compat/manifest';

// What keeps mod packs apart from the rest of the extension, and what a pack owes before it is
// accepted (src/modtools/README.md): a settings page of its own with one switch per tool, a
// maintainer to send problems to, and no way for core code to reach into it.

const repoRoot = findRepoRoot();

interface Section { title?: string; properties: Record<string, unknown> }

const idPattern = /^[a-z][A-Za-z0-9]*$/;
const packSettingPattern = /^mdHoi4Utilities\.modTools\.([^.]+)\.([^.]+)$/;

/** Every way the packs and the settings sections disagree, as readable lines. */
function packContractProblems(packs: readonly ModToolPack[], sections: readonly Section[]): string[] {
    const problems: string[] = [];
    const expected = new Map<string, string>();
    const packIds = new Set<string>();
    for (const pack of packs) {
        if (!idPattern.test(pack.id)) {
            problems.push(`pack id ${pack.id} is not camelCase`);
        }
        if (packIds.has(pack.id)) {
            problems.push(`pack id ${pack.id} is used twice`);
        }
        packIds.add(pack.id);
        if (pack.maintainer.name.trim() === '') {
            problems.push(`${pack.id} has no maintainer name`);
        }
        if (!/^https:\/\/\S+$/.test(pack.maintainer.issues)) {
            problems.push(`${pack.id} has no https:// issue tracker`);
        }
        if (pack.detect.files.length === 0) {
            problems.push(`${pack.id} detects no files, so it would show in every workspace`);
        }
        if (pack.tools.length === 0) {
            problems.push(`${pack.id} has no tools`);
        }
        const toolIds = new Set<string>();
        for (const tool of pack.tools) {
            if (!idPattern.test(tool.id) || toolIds.has(tool.id)) {
                problems.push(`${pack.id}: tool id ${tool.id} is not camelCase or is used twice`);
            }
            toolIds.add(tool.id);
            expected.set(`mdHoi4Utilities.modTools.${pack.id}.${tool.id}`, pack.id);
        }
    }

    for (const section of sections) {
        const keys = Object.keys(section.properties);
        const packsHere = new Set(keys.filter(k => packSettingPattern.test(k)).map(k => packSettingPattern.exec(k)![1]));
        if (packsHere.size === 0) {
            continue;
        }
        if (packsHere.size > 1 || keys.some(k => !packSettingPattern.test(k))) {
            problems.push(`${section.title}: a pack's settings need a section of their own`);
        }
        for (const key of keys) {
            if (packSettingPattern.test(key) && !expected.has(key)) {
                problems.push(`${key} belongs to no registered tool`);
            }
        }
    }
    const contributed = new Set(sections.flatMap(s => Object.keys(s.properties)));
    for (const key of expected.keys()) {
        if (!contributed.has(key)) {
            problems.push(`${key} is not contributed in package.json`);
        }
    }
    return problems;
}

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return full === path.join(repoRoot, 'src', 'test') ? [] : sourceFiles(full);
        }
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
    });
}

const importPattern = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

function imports(file: string): string[] {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(importPattern)].map(m => path.resolve(path.dirname(file), m[1]!));
}

describe('mod tool packs', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const sections: Section[] = packageJson.contributes.configuration;

    it('each registered pack meets the contract and matches its settings page', () => {
        assert.deepStrictEqual(packContractProblems(modToolPacks, sections), []);
    });

    it('reports a pack without a page, a stray setting and a shared page', () => {
        const pack: ModToolPack = {
            id: 'someMod',
            displayName: 'Some mod',
            maintainer: { name: 'The team', issues: 'https://example.com/issues' },
            detect: { files: ['marker'] },
            tools: [{ id: 'doIt', title: 'Do it', run: async () => undefined }],
        };
        assert.deepStrictEqual(packContractProblems([pack], [{ title: 'Mod tools', properties: {} }]),
            ['mdHoi4Utilities.modTools.someMod.doIt is not contributed in package.json']);
        assert.deepStrictEqual(packContractProblems([pack], [{
            title: 'Shared',
            properties: { 'mdHoi4Utilities.modTools.someMod.doIt': {}, 'mdHoi4Utilities.modTools.someMod.gone': {}, 'mdHoi4Utilities.other': {} },
        }]), [
            'Shared: a pack\'s settings need a section of their own',
            'mdHoi4Utilities.modTools.someMod.gone belongs to no registered tool',
        ]);
        assert.deepStrictEqual(packContractProblems([{ ...pack, maintainer: { name: ' ', issues: 'mailto:x' }, detect: { files: [] } }],
            [{ title: 'Some mod', properties: { 'mdHoi4Utilities.modTools.someMod.doIt': {} } }]), [
            'someMod has no maintainer name',
            'someMod has no https:// issue tracker',
            'someMod detects no files, so it would show in every workspace',
        ]);
    });

    it('is reached from the rest of the extension only through extension.ts importing the host', () => {
        const modtoolsDir = path.join(repoRoot, 'src', 'modtools');
        const host = path.join(modtoolsDir, 'host');
        const found: string[] = [];
        for (const file of sourceFiles(path.join(repoRoot, 'src'))) {
            if (file.startsWith(modtoolsDir + path.sep)) {
                continue;
            }
            for (const target of imports(file)) {
                const allowed = file === path.join(repoRoot, 'src', 'extension.ts') && target === host;
                if ((target === modtoolsDir || target.startsWith(modtoolsDir + path.sep)) && !allowed) {
                    found.push(`${path.relative(repoRoot, file)} imports ${path.relative(repoRoot, target)}`);
                }
            }
        }
        assert.deepStrictEqual(found, []);
    });

    it('loads packs only through the registry', () => {
        const modtoolsDir = path.join(repoRoot, 'src', 'modtools');
        const packsDir = path.join(modtoolsDir, 'packs');
        const found: string[] = [];
        for (const file of sourceFiles(modtoolsDir)) {
            if (file.startsWith(packsDir + path.sep) || file === path.join(modtoolsDir, 'registry.ts')) {
                continue;
            }
            for (const target of imports(file)) {
                if (target.startsWith(packsDir + path.sep)) {
                    found.push(`${path.relative(repoRoot, file)} imports ${path.relative(repoRoot, target)}`);
                }
            }
        }
        assert.deepStrictEqual(found, []);
    });
});
