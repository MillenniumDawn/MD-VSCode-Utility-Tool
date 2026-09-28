// The base game's names-only manifest (compat/vanilla-manifest.json.gz, written by
// scripts/vanilla-manifest.js) and the scanner that finds the game paths and sprite names the
// extension's own source hardcodes. The hardcoded-path test puts the two together: every name the
// source relies on has to exist in the base game, or be allowlisted with a reason.

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as ts from 'typescript';

export interface VanillaManifest {
	version: string;
	files: string[];
	dirs: string[];
	sprites: string[];
}

export interface AllowlistEntry {
	value: string;
	reason: string;
	issue?: string;
}

/** A game path or sprite name found in source. `prefix` when the rest is computed at runtime. */
export interface HardcodedHit {
	file: string;
	line: number;
	value: string;
	prefix: boolean;
}

export function findRepoRoot(from: string = __dirname): string {
	let dir = from;
	while (!fs.existsSync(path.join(dir, 'package.json')) || !fs.existsSync(path.join(dir, 'compat'))) {
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`No repository root above ${from}`);
		}
		dir = parent;
	}
	return dir;
}

export function loadManifest(file: string = path.join(findRepoRoot(), 'compat', 'vanilla-manifest.json.gz')): VanillaManifest {
	return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

/** Case-insensitive lookups, because the game resolves paths case-insensitively. */
export class ManifestIndex {
	private readonly files: Set<string>;
	private readonly dirs: Set<string>;
	private readonly sprites: Set<string>;
	private readonly sortedNames: string[];

	constructor(readonly manifest: VanillaManifest) {
		this.files = new Set(manifest.files.map(f => f.toLowerCase()));
		this.dirs = new Set(manifest.dirs.map(d => d.toLowerCase()));
		this.sprites = new Set(manifest.sprites.map(s => s.toLowerCase()));
		this.sortedNames = [...this.files, ...this.dirs, ...this.sprites].sort();
	}

	hasFile(relative: string): boolean {
		return this.files.has(normalise(relative));
	}

	hasDir(relative: string): boolean {
		return this.dirs.has(normalise(relative).replace(/\/+$/, ''));
	}

	hasSprite(name: string): boolean {
		return this.sprites.has(name.toLowerCase());
	}

	/** True when some file, folder or sprite name starts with `prefix`. */
	hasPrefix(prefix: string): boolean {
		const wanted = normalise(prefix);
		let low = 0;
		let high = this.sortedNames.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (this.sortedNames[mid] < wanted) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return low < this.sortedNames.length && this.sortedNames[low].startsWith(wanted);
	}

	has(hit: Pick<HardcodedHit, 'value' | 'prefix'>): boolean {
		if (hit.prefix) {
			return this.hasPrefix(hit.value);
		}
		return this.hasFile(hit.value) || this.hasDir(hit.value) || this.hasSprite(hit.value);
	}
}

function normalise(relative: string): string {
	return relative.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

const gamePathPattern = /^(common|events|interface|gfx|map|history|localisation)(\/|$)/;
const spritePattern = /^GFX_/;

function candidate(value: string, prefix: boolean, file: string, line: number): HardcodedHit | undefined {
	let text = value;
	let isPrefix = prefix;
	const star = text.indexOf('*');
	if (star >= 0) {
		text = text.slice(0, star);
		isPrefix = true;
	}
	if (!gamePathPattern.test(text) && !spritePattern.test(text)) {
		return undefined;
	}
	return { file, line, value: text, prefix: isPrefix };
}

function literalConcat(node: ts.Expression): string | undefined {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text;
	}
	if (ts.isParenthesizedExpression(node)) {
		return literalConcat(node.expression);
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = literalConcat(node.left);
		const right = literalConcat(node.right);
		return left === undefined || right === undefined ? undefined : left + right;
	}
	return undefined;
}

/**
 * Every string in `sourceText` that names a game path or a `GFX_` sprite. A template literal or
 * a concatenation with a dynamic suffix is only the start of the name.
 */
export function scanHardcoded(sourceText: string, file: string): HardcodedHit[] {
	const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
	const hits: HardcodedHit[] = [];
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExternalModuleReference(node)) {
			return;
		}
		let hit: HardcodedHit | undefined;
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
			const value = literalConcat(node);
			if (value !== undefined) {
				let expression: ts.Node = node;
				while (ts.isParenthesizedExpression(expression.parent)) {
					expression = expression.parent;
				}
				const parent = expression.parent;
				const leftOfPlus = ts.isBinaryExpression(parent)
					&& parent.operatorToken.kind === ts.SyntaxKind.PlusToken && parent.left === expression;
				hit = candidate(value, leftOfPlus, file, lineOf(node));
				if (hit) {
					hits.push(hit);
				}
				return;
			}
		}
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			const parent = node.parent;
			const leftOfPlus = ts.isBinaryExpression(parent)
				&& parent.operatorToken.kind === ts.SyntaxKind.PlusToken
				&& parent.left === node;
			hit = candidate(node.text, leftOfPlus, file, lineOf(node));
		} else if (ts.isTemplateExpression(node) && node.head.text !== '') {
			hit = candidate(node.head.text, true, file, lineOf(node));
		}
		if (hit) {
			hits.push(hit);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return hits;
}

/** The string defaults of the extension's settings, which reach the game exactly like source does. */
export function scanPackageDefaults(packageText: string, file = 'package.json'): HardcodedHit[] {
	const pkg = JSON.parse(packageText);
	const configuration = pkg.contributes?.configuration;
	const sections: any[] = Array.isArray(configuration) ? configuration : configuration ? [configuration] : [];
	const lines = packageText.split(/\r?\n/);
	const hits: HardcodedHit[] = [];
	const collect = (value: unknown): void => {
		if (typeof value === 'string') {
			const line = lines.findIndex(l => l.includes(JSON.stringify(value))) + 1;
			const hit = candidate(value, false, file, line);
			if (hit) {
				hits.push(hit);
			}
		} else if (Array.isArray(value)) {
			value.forEach(collect);
		} else if (value && typeof value === 'object') {
			Object.values(value).forEach(collect);
		}
	};
	for (const section of sections) {
		for (const property of Object.values<any>(section.properties ?? {})) {
			collect(property.default);
		}
	}
	return hits;
}

export interface HardcodedCheck {
	/** Hits that are neither in the base game nor allowlisted. */
	missing: HardcodedHit[];
	/** Allowlist entries no hit uses any more. */
	stale: AllowlistEntry[];
}

export function checkHardcoded(hits: HardcodedHit[], index: ManifestIndex, allowlist: AllowlistEntry[]): HardcodedCheck {
	const allowed = new Set(allowlist.map(e => e.value));
	const used = new Set<string>();
	const missing: HardcodedHit[] = [];
	for (const hit of hits) {
		if (allowed.has(hit.value)) {
			used.add(hit.value);
		} else if (!index.has(hit)) {
			missing.push(hit);
		}
	}
	return { missing, stale: allowlist.filter(e => !used.has(e.value)) };
}

export function formatHit(hit: HardcodedHit): string {
	return `${hit.file}:${hit.line}  ${hit.value}${hit.prefix ? '…' : ''}`;
}
