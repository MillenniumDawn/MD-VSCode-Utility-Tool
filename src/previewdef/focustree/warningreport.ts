import * as vscode from "vscode";
import * as path from "path";
import { Commands } from "../../constants";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { loadBounded } from "../../util/dependency";
import { error } from "../../util/debug";
import { getFlags } from "../../util/featureflags";
import {
	listFilesFromModOrHOI4,
	readFileFromModOrHOI4,
} from "../../util/fileloader";
import { localize } from "../../util/i18n";
import { isRecord } from "../../util/messageguards";
import { ProgressReport, withCancellableProgress } from "../../util/progress";
import { sendEvent } from "../../util/telemetry";
import { getConfiguration } from "../../util/vsccommon";
import {
	convertFocusFileNodeToJson,
	extractOrListIds,
	FocusTree,
	getFocusTreeWithFocusFile,
} from "./schema";

export interface ReportedWarning {
	treeId: string;
	source: string;
	text: string;
}

export interface FileWarnings {
	file: string;
	warnings: ReportedWarning[];
	parseError?: string;
}

export interface ParsedFocusFile {
	path: string;
	file: ReturnType<typeof convertFocusFileNodeToJson>;
}

const focusFolder = "common/national_focus";
export const auditReportFileName = "focus-tree-audit.md";

/**
 * The warnings the focus tree preview would show, for every file at once, each listed under the
 * file that defines the focus it is about.
 *
 * A shared focus is merged into every country tree that names it, and the warnings about it come
 * along, so reading them per tree would list one shared-focus problem once per country. Keyed by
 * the defining file instead, it is listed once, where it has to be fixed.
 */
export function collectFocusWarnings(parsed: ParsedFocusFile[]): FileWarnings[] {
	const treesByFile = new Map<string, FocusTree[]>();
	for (const { path: filePath, file } of parsed) {
		treesByFile.set(filePath, getFocusTreeWithFocusFile(file, [], filePath, {}));
	}

	// The preview merges a tree's shared focuses only with conditions on; without them the first
	// pass is already what it shows.
	if (getFlags().useConditionInFocus) {
		const sharedTrees = [...treesByFile.entries()].flatMap(([filePath, trees]) =>
			trees.filter((tree) => tree.isSharedFocues).map((tree) => ({ filePath, tree })),
		);
		for (const { path: filePath, file } of parsed) {
			const usesSharedFocuses = file.focus_tree.some(
				(tree) => extractOrListIds(tree.shared_focus).length > 0,
			);
			if (usesSharedFocuses) {
				const donors = sharedTrees.filter((s) => s.filePath !== filePath).map((s) => s.tree);
				treesByFile.set(filePath, getFocusTreeWithFocusFile(file, donors, filePath, {}));
			}
		}
	}

	const reported = new Map<string, ReportedWarning[]>();
	const seen = new Set<string>();
	const add = (file: string, warning: ReportedWarning) => {
		const key = `${file}\n${warning.source}\n${warning.text}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		const list = reported.get(file);
		if (list === undefined) {
			reported.set(file, [warning]);
		} else {
			list.push(warning);
		}
	};

	// A file's own trees go first, so a warning both the donor file and a country tree carry is
	// listed with the donor's tree name.
	for (const ownTreesOnly of [true, false]) {
		for (const [filePath, trees] of treesByFile) {
			for (const tree of trees) {
				for (const warning of tree.warnings) {
					const definedIn = tree.focuses[warning.source]?.file ?? filePath;
					if ((definedIn === filePath) === ownTreesOnly) {
						add(definedIn, { treeId: tree.id, source: warning.source, text: warning.text });
					}
				}
			}
		}
	}

	return [...reported.entries()].map(([file, warnings]) => ({ file, warnings }));
}

function oneLine(text: string): string {
	return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** One file's warnings as a Markdown section: the copy button copies exactly this for its tree. */
export function formatFileWarnings(file: FileWarnings): string {
	const lines = [`## ${file.file}`, ""];
	if (file.parseError !== undefined) {
		lines.push(
			"- " + localize("focustree.audit.parsefailed", "Could not parse this file: {0}", oneLine(file.parseError)),
		);
	}
	for (const warning of file.warnings) {
		lines.push(`- \`${warning.source}\` (\`${warning.treeId}\`): ${oneLine(warning.text)}`);
	}
	return lines.join("\n") + "\n";
}

export function formatFocusWarningReport(files: FileWarnings[], checkedFileCount: number): string {
	const withProblems = files
		.filter((f) => f.warnings.length > 0 || f.parseError !== undefined)
		.sort((a, b) => a.file.localeCompare(b.file));
	const problemCount = withProblems.reduce(
		(sum, f) => sum + f.warnings.length + (f.parseError !== undefined ? 1 : 0),
		0,
	);

	const sections = [
		`# ${localize("focustree.audit.title", "Focus tree warnings")}`,
		localize(
			"focustree.audit.summary",
			"Checked {0} focus tree files: {1} warnings in {2} files.",
			checkedFileCount,
			problemCount,
			withProblems.length,
		),
	];
	if (withProblems.length === 0) {
		sections.push(localize("focustree.audit.nowarnings", "No warnings."));
	}
	return sections.join("\n\n") + "\n" + withProblems.map((f) => "\n" + formatFileWarnings(f)).join("");
}

function isWarningList(value: unknown): value is { source: string; text: string }[] {
	return Array.isArray(value) && value.every(
		(w) => isRecord(w) && typeof w.source === "string" && typeof w.text === "string",
	);
}

/**
 * Answers the preview's copy button: `msg` is what the webview posted for the tree on screen, and
 * `file` the previewed file. The clipboard gets the same section the audit report has for it. The
 * MIO preview posts the same message for the organization on screen, and passes its own
 * `noWarningsMessage`.
 */
export async function copyTreeWarnings(msg: unknown, file: string, noWarningsMessage?: string): Promise<void> {
	if (!isRecord(msg) || typeof msg.treeId !== "string" || !isWarningList(msg.warnings)) {
		return;
	}
	if (msg.warnings.length === 0) {
		void vscode.window.showInformationMessage(
			noWarningsMessage ?? localize("focustree.copywarnings.none", "This focus tree has no warnings."),
		);
		return;
	}
	const treeId = msg.treeId;
	const warnings = msg.warnings.map((w) => ({ treeId, source: w.source, text: w.text }));
	await vscode.env.clipboard.writeText(formatFileWarnings({ file, warnings }));
	void vscode.window.showInformationMessage(
		localize("focustree.copywarnings.done", "Copied {0} warnings.", warnings.length),
	);
}

/** Reads and checks every focus tree file; `undefined` when the reader cancelled. */
export async function buildFocusTreeAuditReport(
	progress: ProgressReport,
	includeVanilla: boolean,
): Promise<string | undefined> {
	const options = { hoi4: includeVanilla };
	const files = (await listFilesFromModOrHOI4(focusFolder, options))
		.filter((file) => file.toLowerCase().endsWith(".txt"))
		.map((file) => `${focusFolder}/${file}`);

	let done = 0;
	const loaded = await loadBounded(files, async (filePath) => {
		if (progress.token.isCancellationRequested) {
			return undefined;
		}
		try {
			const [buffer] = await readFileFromModOrHOI4(filePath, options);
			const node = parseHoi4File(buffer.toString());
			return { path: filePath, file: convertFocusFileNodeToJson(node, {}) };
		} catch (e) {
			return { path: filePath, parseError: e instanceof Error ? e.message : String(e) };
		} finally {
			progress.report(++done, files.length);
		}
	});

	if (progress.token.isCancellationRequested) {
		return undefined;
	}

	const parsed = loaded.filter((f): f is ParsedFocusFile => "file" in f);
	const failed: FileWarnings[] = loaded
		.filter((f): f is { path: string; parseError: string } => "parseError" in f)
		.map((f) => ({ file: f.path, warnings: [], parseError: f.parseError }));

	return formatFocusWarningReport([...collectFocusWarnings(parsed), ...failed], files.length);
}

function reportFolderUri(folder: string): vscode.Uri {
	if (path.isAbsolute(folder)) {
		return vscode.Uri.file(folder);
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder === undefined) {
		throw new Error(
			localize(
				"focustree.audit.noworkspace",
				"The report folder {0} is relative, but no workspace folder is open. Use an absolute path.",
				folder,
			),
		);
	}
	return vscode.Uri.joinPath(workspaceFolder.uri, folder);
}

async function showReport(report: string, folder: string): Promise<void> {
	if (folder === "") {
		const document = await vscode.workspace.openTextDocument({ language: "markdown", content: report });
		await vscode.window.showTextDocument(document);
		return;
	}
	const folderUri = reportFolderUri(folder);
	await vscode.workspace.fs.createDirectory(folderUri);
	const reportUri = vscode.Uri.joinPath(folderUri, auditReportFileName);
	await vscode.workspace.fs.writeFile(reportUri, Buffer.from(report, "utf8"));
	await vscode.window.showTextDocument(reportUri);
}

export async function auditFocusTrees(): Promise<void> {
	sendEvent("auditFocusTrees");
	const config = getConfiguration();
	const folder = (config.get<string>("auditor.reportFolder") ?? "").trim();
	const includeVanilla = config.get<boolean>("auditor.includeVanilla") ?? false;

	try {
		const report = await withCancellableProgress(
			localize("focustree.audit.progress", "Checking focus trees"),
			(progress) => buildFocusTreeAuditReport(progress, includeVanilla),
		);
		// A cancel says nothing: the reader pressed Cancel and already knows.
		if (report !== undefined) {
			await showReport(report, folder);
		}
	} catch (e) {
		error(e);
		void vscode.window.showErrorMessage(
			localize("focustree.audit.failed", "Checking the focus trees failed: {0}", `${e instanceof Error ? e.message : e}`),
		);
	}
}

export function registerAuditFocusTreesCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(Commands.AuditFocusTrees, auditFocusTrees);
}
