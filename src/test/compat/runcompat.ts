// Runs every preview's real loader and content builder, headless, over a real mod folder, and
// reports what broke. One runner for three jobs: the vanilla-shaped fixture in `npm test`, the
// compat workflow over the mods in compat/mods.json, and a local run against the game install.
//
//   npm run compat -- --mod <dir> [--game <installDir>] [--parent <dir>]... [--only focustree,event]
//                     [--baseline <file>] [--update-baseline] [--report <file>] [--label <name>] [--verbose]
//
// A problem is an exception, a parse failure, an error page, or an ERROR/WARN log line raised
// while one file previews. Not counted: the mod's own content warnings (the preview shows those to
// the modder, they are not the extension's fault), and, with no game mounted, a base-game file the
// manifest lists or any image, since neither is there to be read. With a baseline, only problems
// it does not already list fail the run, so a mod moving on upstream never breaks an unrelated
// pull request.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../../util/logger';
import { LoaderRender, normalizeRender, renderedHtml } from '../../previewdef/updateablepreview';
import { CharactersLoader } from '../../previewdef/character/loader';
import { renderCharacterFile } from '../../previewdef/character/contentbuilder';
import { DecisionsLoader } from '../../previewdef/decision/loader';
import { renderDecisionFile } from '../../previewdef/decision/contentbuilder';
import { EventsLoader } from '../../previewdef/event/loader';
import { renderEventFile } from '../../previewdef/event/contentbuilder';
import { IdeasLoader } from '../../previewdef/idea/loader';
import { renderIdeaFile } from '../../previewdef/idea/contentbuilder';
import { MioLoader } from '../../previewdef/mio/loader';
import { renderMioFile } from '../../previewdef/mio/contentbuilder';
import { TechnologyTreeLoader } from '../../previewdef/technology/loader';
import { renderTechnologyFile } from '../../previewdef/technology/contentbuilder';
import { GuiFileLoader } from '../../previewdef/gui/loader';
import { renderGuiFile } from '../../previewdef/gui/contentbuilder';
import { renderGfxFile } from '../../previewdef/gfx/contentbuilder';
import { FocusTreeLoader } from '../../previewdef/focustree/loader';
import { buildFocusTreeHtml, buildFocusTreePayload, buildNoFocusTreeHtml } from '../../previewdef/focustree/contentbuilder';
import { ManifestIndex, findRepoRoot, loadManifest } from './manifest';
import { mountRealDisk } from './realdisk';

export const previewTypes = ['focustree', 'event', 'decision', 'idea', 'character', 'mio', 'technology', 'gui', 'gfx'] as const;
export type PreviewType = typeof previewTypes[number];

interface PreviewDef {
	/** Files directly in this folder, or anywhere under it with `recursive`. */
	dir: string;
	extension: string;
	recursive?: boolean;
	render(file: string, uri: vscode.Uri, webview: vscode.Webview): Promise<LoaderRender>;
}

const previews: Record<PreviewType, PreviewDef> = {
	focustree: {
		dir: 'common/national_focus', extension: '.txt',
		async render(file, uri, webview) {
			// Null is a file with no focus tree in it, or a failure the builder has already logged.
			const payload = await buildFocusTreePayload(new FocusTreeLoader(file));
			return payload === null ? buildNoFocusTreeHtml(webview, uri) : buildFocusTreeHtml(payload, webview, uri);
		},
	},
	event: { dir: 'events', extension: '.txt', render: (f, u, w) => renderEventFile(new EventsLoader(f), u, w) },
	decision: { dir: 'common/decisions', extension: '.txt', render: (f, u, w) => renderDecisionFile(new DecisionsLoader(f), u, w) },
	idea: { dir: 'common/ideas', extension: '.txt', render: (f, u, w) => renderIdeaFile(new IdeasLoader(f), u, w) },
	character: { dir: 'common/characters', extension: '.txt', render: (f, u, w) => renderCharacterFile(new CharactersLoader(f), u, w) },
	mio: {
		dir: 'common/military_industrial_organization/organizations', extension: '.txt',
		render: (f, u, w) => renderMioFile(new MioLoader(f), u, w),
	},
	technology: {
		dir: 'common/technologies', extension: '.txt',
		render: (f, u, w) => renderTechnologyFile(new TechnologyTreeLoader(f), u, w),
	},
	gui: { dir: 'interface', extension: '.gui', recursive: true, render: (f, u, w) => renderGuiFile(new GuiFileLoader(f), u, w) },
	gfx: {
		dir: 'interface', extension: '.gfx', recursive: true,
		render: async (_f, u, w) => renderGfxFile((await fs.promises.readFile(u.fsPath, 'utf8')).replace(/^﻿/, ''), u, w),
	},
};

export interface CompatOptions {
	modDir: string;
	gameDir?: string;
	parentDirs?: string[];
	only?: PreviewType[];
	/** Problems already known; see `diffBaseline`. */
	baseline?: string[];
	label?: string;
	manifest?: ManifestIndex;
	/** Called after each file, for a progress line. */
	onFile?: (type: PreviewType, file: string, milliseconds: number, problems: number) => void;
}

export interface Problem {
	type: PreviewType;
	file: string;
	message: string;
}

export interface TypeCounts {
	files: number;
	clean: number;
	problems: number;
	ignored: number;
}

export interface CompatResult {
	label: string;
	gameMounted: boolean;
	gameVersion: string;
	counts: Record<PreviewType, TypeCounts>;
	problems: Problem[];
	/** Problems the baseline does not list; the run fails on these. */
	newProblems: Problem[];
	/** Baseline entries this run no longer produced. */
	fixed: string[];
}

/**
 * A baseline is a JSON array of problem keys. An entry can instead be `{ problem, issue, reason }`,
 * for a known problem worth saying why it is there and what fixes it.
 */
export function readBaseline(file: string): string[] {
	const entries: Array<string | { problem: string }> = JSON.parse(fs.readFileSync(file, 'utf8'));
	return entries.map(e => typeof e === 'string' ? e : e.problem);
}

export function problemKey(problem: Problem): string {
	return `${problem.type}|${problem.file}|${problem.message}`;
}

export function listPreviewFiles(modDir: string, type: PreviewType): string[] {
	const def = previews[type];
	const files: string[] = [];
	const walk = (relative: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(path.join(modDir, relative), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const child = relative + '/' + entry.name;
			if (entry.isDirectory()) {
				if (def.recursive) {
					walk(child);
				}
			} else if (entry.name.toLowerCase().endsWith(def.extension)) {
				files.push(child);
			}
		}
	};
	walk(def.dir);
	return files.sort();
}

/** One line, with the machine's own folders replaced, so the same problem reads the same anywhere. */
export function normaliseMessage(message: string, roots: Record<string, string>): string {
	// The first line, and the one after it when the first only introduces it ("In file x:").
	const lines = message.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
	let text = lines.length > 1 && lines[0].endsWith(':') ? `${lines[0]} ${lines[1]}` : lines[0] ?? '';
	for (const [name, dir] of Object.entries(roots)) {
		const resolved = path.resolve(dir);
		for (const variant of new Set([resolved, resolved.replace(/\\/g, '/')])) {
			text = text.split('file://' + variant).join(name).split(variant).join(name);
		}
	}
	// Forward slashes, so a baseline written on Windows matches a run on Linux; and no loader
	// chain, whose order is the order a folder happened to list in.
	text = text.replace(/\\/g, '/').replace(/(Loading loaders:).*/, '$1 …').replace(/\s+/g, ' ');
	return text.length > 300 ? text.slice(0, 300) + '…' : text;
}

const gamePathInMessage = /(?:^|[\s"'`(/:])((?:common|events|interface|gfx|map|history|localisation)\/[^\s"'`),;:]+)/g;
const imageExtension = /\.(dds|tga|png|bmp|jpe?g)$/i;

/**
 * With no game mounted, a problem that only names base-game files or images is expected: they are
 * not there to be read. Anything else, including a file the base game does not have, counts.
 */
export function isMissingGameFile(message: string, manifest: ManifestIndex): boolean {
	const paths = [...message.matchAll(gamePathInMessage)].map(m => m[1].replace(/[.]+$/, ''));
	return paths.length > 0 && paths.every(p => imageExtension.test(p) || manifest.hasFile(p));
}

function errorPageMessage(html: string): string | undefined {
	if (!html.includes('id="preview-reload"')) {
		return undefined;
	}
	const pre = /<pre>([\s\S]*?)<\/pre>/.exec(html);
	return (pre ? pre[1] : 'error page')
		.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&amp;/g, '&');
}

const fakeWebview = {
	asWebviewUri: (uri: vscode.Uri) => uri,
	cspSource: '',
} as unknown as vscode.Webview;

export function diffBaseline(problems: Problem[], baseline: string[] | undefined): { newProblems: Problem[]; fixed: string[] } {
	if (baseline === undefined) {
		return { newProblems: problems, fixed: [] };
	}
	const known = new Set(baseline);
	const seen = new Set(problems.map(problemKey));
	return {
		newProblems: problems.filter(p => !known.has(problemKey(p))),
		fixed: baseline.filter(k => !seen.has(k)),
	};
}

export async function runCompat(options: CompatOptions): Promise<CompatResult> {
	const repoRoot = findRepoRoot();
	const manifest = options.manifest ?? new ManifestIndex(loadManifest());
	const roots: Record<string, string> = { '<mod>': options.modDir };
	if (options.gameDir) {
		roots['<game>'] = options.gameDir;
	}
	(options.parentDirs ?? []).forEach((dir, i) => { roots[`<parent${i + 1}>`] = dir; });

	const disk = await mountRealDisk({
		modDir: options.modDir, gameDir: options.gameDir, parentDirs: options.parentDirs,
	}, path.join(repoRoot, 'package.json'));
	roots['<game>'] = disk.gameDir;

	const logged: string[] = [];
	const { warn, error } = Logger;
	const consoleError = console.error;
	Logger.warn = message => { logged.push(message); };
	Logger.error = message => { logged.push(message); };
	console.error = () => undefined;

	const counts = {} as Record<PreviewType, TypeCounts>;
	const problems: Problem[] = [];
	try {
		for (const type of options.only ?? previewTypes) {
			const typeCounts: TypeCounts = counts[type] = { files: 0, clean: 0, problems: 0, ignored: 0 };
			for (const file of listPreviewFiles(options.modDir, type)) {
				typeCounts.files++;
				logged.length = 0;
				const started = Date.now();
				const raised: string[] = [];
				try {
					const uri = vscode.Uri.file(path.join(options.modDir, file));
					const page = errorPageMessage(renderedHtml(normalizeRender(await previews[type].render(file, uri, fakeWebview))));
					if (page !== undefined) {
						raised.push(page);
					}
				} catch (e) {
					raised.push(e instanceof Error ? e.message : String(e));
				}
				const messages = [...new Set([...logged, ...raised].map(m => normaliseMessage(m, roots)))];
				let counted = 0;
				for (const message of messages) {
					if (!options.gameDir && isMissingGameFile(message, manifest)) {
						typeCounts.ignored++;
					} else {
						problems.push({ type, file, message });
						counted++;
					}
				}
				typeCounts.problems += counted;
				options.onFile?.(type, file, Date.now() - started, counted);
				if (counted === 0) {
					typeCounts.clean++;
				}
			}
		}
	} finally {
		Logger.warn = warn;
		Logger.error = error;
		console.error = consoleError;
		await disk.unmount();
	}

	return {
		label: options.label ?? path.basename(path.resolve(options.modDir)),
		gameMounted: options.gameDir !== undefined,
		gameVersion: manifest.manifest.version,
		counts,
		problems,
		...diffBaseline(problems, options.baseline),
	};
}

export function formatReport(result: CompatResult): string {
	const lines = [
		`### Compat: ${result.label}`,
		'',
		result.gameMounted ? 'Game install mounted.' : `No game mounted; base-game files checked against the ${result.gameVersion} manifest.`,
		'',
		'| Preview | Files | Clean | Problems | Ignored |',
		'| --- | ---: | ---: | ---: | ---: |',
		...Object.entries(result.counts).map(([type, c]) => `| ${type} | ${c.files} | ${c.clean} | ${c.problems} | ${c.ignored} |`),
		'',
		`${result.problems.length} problem(s), ${result.newProblems.length} not in the baseline, `
			+ `${result.fixed.length} baseline entr${result.fixed.length === 1 ? 'y' : 'ies'} no longer seen.`,
	];
	if (result.newProblems.length > 0) {
		lines.push('', '#### New problems', '', ...result.newProblems.map(p => `- \`${p.type}\` ${p.file}: ${p.message}`));
	}
	if (result.fixed.length > 0) {
		lines.push('', '#### No longer seen (run with --update-baseline to drop them)', '', ...result.fixed.map(k => `- ${k}`));
	}
	return lines.join('\n') + '\n';
}

export interface CliOptions extends CompatOptions {
	baselineFile?: string;
	updateBaseline: boolean;
	reportFile?: string;
	verbose?: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
	const options: Partial<CliOptions> & { parentDirs: string[] } = { parentDirs: [], updateBaseline: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = (): string => {
			const next = argv[++i];
			if (next === undefined || next.startsWith('--')) {
				throw new Error(`${arg} needs a value`);
			}
			return next;
		};
		switch (arg) {
			case '--mod': options.modDir = path.resolve(value()); break;
			case '--game': options.gameDir = path.resolve(value()); break;
			case '--parent': options.parentDirs.push(path.resolve(value())); break;
			case '--baseline': options.baselineFile = path.resolve(value()); break;
			case '--update-baseline': options.updateBaseline = true; break;
			case '--report': options.reportFile = path.resolve(value()); break;
			case '--label': options.label = value(); break;
			case '--verbose': options.verbose = true; break;
			case '--only': {
				const types = value().split(',').map(t => t.trim());
				const unknown = types.filter(t => !(previewTypes as readonly string[]).includes(t));
				if (unknown.length > 0) {
					throw new Error(`Unknown preview type(s): ${unknown.join(', ')}; expected ${previewTypes.join(', ')}`);
				}
				options.only = types as PreviewType[];
				break;
			}
			default: throw new Error(`Unknown argument ${arg}`);
		}
	}
	if (!options.modDir) {
		throw new Error('--mod <dir> is required');
	}
	return options as CliOptions;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, log: (s: string) => void = console.log): Promise<number> {
	let options: CliOptions;
	try {
		options = parseArgs(argv);
	} catch (e) {
		log(`${(e as Error).message}\nUsage: npm run compat -- --mod <dir> [--game <dir>] [--parent <dir>]... `
			+ '[--only <types>] [--baseline <file>] [--update-baseline] [--report <file>] [--label <name>] [--verbose]');
		return 2;
	}
	if (options.updateBaseline && !options.baselineFile) {
		log('--update-baseline needs --baseline <file>');
		return 2;
	}
	if (options.baselineFile && fs.existsSync(options.baselineFile) && !options.updateBaseline) {
		options.baseline = readBaseline(options.baselineFile);
	}

	if (options.verbose) {
		options.onFile = (type, file, ms, problems) => log(`${type} ${file} ${ms}ms${problems ? ` ${problems} problem(s)` : ''}`);
	}
	const result = await runCompat(options);
	const report = formatReport(result);
	log(report);
	if (options.reportFile) {
		fs.writeFileSync(options.reportFile, report);
	}
	if (env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(env.GITHUB_STEP_SUMMARY, report);
	}
	if (options.updateBaseline && options.baselineFile) {
		const keys = [...new Set(result.problems.map(problemKey))].sort();
		fs.mkdirSync(path.dirname(options.baselineFile), { recursive: true });
		fs.writeFileSync(options.baselineFile, JSON.stringify(keys, undefined, '\t') + '\n');
		log(`Wrote ${keys.length} baseline entr${keys.length === 1 ? 'y' : 'ies'} to ${options.baselineFile}`);
		return 0;
	}
	return result.newProblems.length > 0 ? 1 : 0;
}

if (require.main === module) {
	// Exits rather than waiting for the event loop: the file and image caches keep timers alive.
	main(process.argv.slice(2)).then(code => process.exit(code), e => {
		console.error(e);
		process.exit(1);
	});
}
