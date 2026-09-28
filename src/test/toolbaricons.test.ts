import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
	actionGroupOrder,
	IconAction,
	IconActionId,
	iconActions,
	iconButtonHtml,
	toolbarActionsClass,
} from "../previewdef/toolbaricons";
import { localize } from "../util/i18n";
import { buildFocusTreeHtml, buildFocusTreePayload } from "../previewdef/focustree/contentbuilder";
import { renderGuiFile } from "../previewdef/gui/contentbuilder";
import { renderWorldMapIcons } from "../previewdef/worldmap/toolbar";
import { toNumberLike } from "../hoiformat/schema";
import { refreshFeatureFlags } from "../util/featureflags";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

// The icon rules of issue #446, as a test. A new icon cannot ship until it passes, so every failure
// message says what to change without the reader having to find the issue first. When a rule
// changes, this test and the issue change together.

const root = path.join(__dirname, "..", "..", "..");
const registryFile = "src/previewdef/toolbaricons.ts";

const actions = iconActions as Record<IconActionId, IconAction>;
const actionIds = Object.keys(actions) as IconActionId[];

function iconsOf(a: IconAction): string[] {
	return typeof a.icon === "string" ? [a.icon] : [a.icon.on, a.icon.off];
}

const registryIcons = new Map<string, IconActionId>();
for (const id of actionIds) {
	for (const icon of iconsOf(actions[id])) {
		registryIcons.set(icon, id);
	}
}

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, accept, out);
		} else if (accept(full)) {
			out.push(full);
		}
	}
	return out;
}

function relative(file: string): string {
	return path.relative(root, file).replace(/\\/g, "/");
}

// Every codicon name written in the sources, wherever it is: `codicon-<name>` in markup and CSS
// classes, `$(<name>)` in status bar text and package.json.
function iconsInSources(): { file: string; icon: string }[] {
	const files = [
		...walk(path.join(root, "src"), f => /\.(ts|html)$/.test(f) && !relative(f).startsWith("src/test/")),
		...walk(path.join(root, "webviewsrc"), f => /\.(ts|html)$/.test(f)),
		...walk(path.join(root, "resource"), f => /\.(css|html)$/.test(f)),
		path.join(root, "package.json"),
	];
	const found: { file: string; icon: string }[] = [];
	for (const file of files) {
		if (relative(file) === registryFile) {
			continue;
		}
		const text = fs.readFileSync(file, "utf8");
		for (const match of text.matchAll(/codicon-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
			found.push({ file: relative(file), icon: match[1] });
		}
		for (const match of text.matchAll(/\$\(([a-z0-9]+(?:-[a-z0-9]+)*)\)/g)) {
			found.push({ file: relative(file), icon: match[1] });
		}
	}
	return found;
}

// Codicons that read as a problem being reported.
function isAlarmIcon(icon: string): boolean {
	return /(^|-)(warning|error|alert|report|bug|issues?)(-|$)/.test(icon);
}

// The first word of a tooltip has to say what the click does.
const tooltipVerbs = [
	"Show", "Hide", "Open", "Save", "Copy", "Reset", "Stop", "Search", "Refresh",
	"Reload", "Zoom", "Expand", "Collapse", "Scan", "Select",
];

interface RenderedButton {
	id: string;
	action: string | undefined;
	title: string | undefined;
	ariaLabel: string | undefined;
	iconOnly: boolean;
}

function attribute(tag: string, name: string): string | undefined {
	return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function buttonsIn(html: string): RenderedButton[] {
	const buttons: RenderedButton[] = [];
	for (const match of html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)) {
		const tag = match[1];
		const content = match[2];
		buttons.push({
			id: attribute(tag, "id") ?? "",
			action: attribute(tag, "data-action"),
			title: attribute(tag, "title"),
			ariaLabel: attribute(tag, "aria-label"),
			iconOnly: content.replace(/<i\b[^>]*><\/i>/g, "").trim() === "",
		});
	}
	return buttons;
}

// The action ids inside a toolbar's action group, in the order they are drawn.
function actionGroupOf(html: string): string[] {
	const start = html.indexOf(`class="${toolbarActionsClass}`);
	if (start < 0) {
		return [];
	}
	return buttonsIn(html.substring(start)).map(b => b.action).filter((a): a is string => a !== undefined);
}

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "test-csp",
} as unknown as vscode.Webview;

async function renderedFocusTree(withWarnings: boolean): Promise<string> {
	const tree = {
		id: "test_tree",
		focuses: {
			focus_a: {
				id: "focus_a", x: 0, y: 0, icon: [{ icon: "GFX_focus_a" }], text: undefined,
				textIcon: undefined, overlay: undefined, token: { start: 0, end: 10 },
				file: "common/national_focus/test.txt",
			},
		},
		inlayWindows: [],
		inlayWindowRefs: [],
		warnings: withWarnings ? [{ text: "Focuses a and b overlap.", source: "focus_a" }] : [],
		allowBranchOptions: [],
		_token: { start: 0, end: 20 },
	};
	const loader: any = {
		file: "common/national_focus/test.txt",
		load: async () => ({ result: { focusTrees: [tree], gfxFiles: [] } }),
	};
	const payload = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
	return buildFocusTreeHtml(payload!, webview, vscode.Uri.file("/tmp/common/national_focus/test.txt"));
}

async function renderedGui(): Promise<string> {
	const window = {
		name: "main", position: { x: toNumberLike(0), y: toNumberLike(0) },
		size: { width: toNumberLike(200), height: toNumberLike(100) },
		containerwindowtype: [], windowtype: [], gridboxtype: [], icontype: [],
		instanttextboxtype: [], textboxtype: [], buttontype: [], checkboxtype: [],
		guibuttontype: [], _token: { start: 0, end: 10 }, _index: 0,
	};
	const loader: any = {
		load: async () => ({
			result: {
				guiFiles: [{ file: "interface/test.gui", data: { guitypes: [{ containerwindowtype: [window], windowtype: [] }] } }],
				gfxFiles: [],
			},
		}),
	};
	return renderGuiFile(loader, vscode.Uri.file("/tmp/interface/test.gui"), webview);
}

function renderedWorldMap(): string {
	const template = fs.readFileSync(path.join(root, "src/previewdef/worldmap/worldmapview.html"), "utf8");
	return renderWorldMapIcons(template, localize);
}

// Every icon button the registry can draw, as the webview's own builders draw it.
function renderedRegistryButtons(): string {
	return actionIds
		.filter(id => actions[id].tooltipKey !== undefined)
		.map(id => iconButtonHtml(id, localize, { domId: id, on: false }) + iconButtonHtml(id, localize, { domId: id, on: true }))
		.join("");
}

describe("toolbar icons (issue #446)", () => {
	let pages: Record<string, string>;

	before(async () => {
		// The stub configuration answers nothing, and the focus tree writes its flags into the page.
		stubVscode({ getConfiguration: () => ({ useConditionInFocus: false }) });
		refreshFeatureFlags();
		pages = {
			"focus tree": await renderedFocusTree(true),
			"focus tree without warnings": await renderedFocusTree(false),
			"GUI": await renderedGui(),
			"world map": renderedWorldMap(),
			"registry": renderedRegistryButtons(),
		};
	});

	after(() => {
		restoreVscodeStubs();
		refreshFeatureFlags();
	});

	it("coverage: every codicon in the sources has an entry in the registry", () => {
		const missing = iconsInSources()
			.filter(({ icon }) => !registryIcons.has(icon))
			.map(({ file, icon }) => `codicon-${icon} in ${file} is not in the icon registry. ` +
				`Add an entry for its action to iconActions in ${registryFile}, and draw the button ` +
				`with iconButtonHtml instead of writing the codicon class by hand.`);
		assert.deepStrictEqual(missing, []);
	});

	// Checked against the stylesheet the webviews load rather than metadata.json, which lists only
	// each icon's main name and so misses aliases like `warning` that the font does draw.
	it("native: every registry codicon is one the bundled @vscode/codicons ships", () => {
		const css = fs.readFileSync(path.join(root, "node_modules/@vscode/codicons/dist/codicon.css"), "utf8");
		const shipped = new Set([...css.matchAll(/\.codicon-([a-z0-9-]+):before/g)].map(m => m[1]));
		const unknown = [...registryIcons.keys()]
			.filter(icon => !shipped.has(icon))
			.map(icon => `codicon-${icon} (action ${registryIcons.get(icon)}) is not in @vscode/codicons. ` +
				`Pick a name from https://microsoft.github.io/vscode-codicons/dist/codicon.html (rule 7).`);
		assert.deepStrictEqual(unknown, []);
	});

	it("one meaning: no codicon belongs to two actions", () => {
		const owners = new Map<string, IconActionId[]>();
		for (const id of actionIds) {
			for (const icon of new Set(iconsOf(actions[id]))) {
				owners.set(icon, [...(owners.get(icon) ?? []), id]);
			}
		}
		const shared = [...owners.entries()]
			.filter(([, ids]) => ids.length > 1)
			.map(([icon, ids]) => `codicon-${icon} is used by ${ids.join(" and ")}. ` +
				`One codicon means one action; give one of them a different icon (rule 2).`);
		assert.deepStrictEqual(shared, []);
	});

	it("no alarm icons: warning and error icons only on an action that reports a problem", () => {
		const wrong = actionIds
			.filter(id => iconsOf(actions[id]).some(isAlarmIcon) && !actions[id].reportsProblem)
			.map(id => `codicon-${iconsOf(actions[id]).find(isAlarmIcon)} on ${id} is an alarm icon on a ` +
				`button that does not open a problem list. Pick a neutral codicon (rule 5).`);
		assert.deepStrictEqual(wrong, []);
	});

	it("no alarm icons: the status bar says in words what is wrong with the mod file", () => {
		const source = fs.readFileSync(path.join(root, "src/util/modfile.ts"), "utf8");
		assert.ok(/statusBarIcon\("modFileError"\)[\s\S]{0,200}localize\("modfile\.cannotread"/.test(source),
			"The status bar's error icon has to come with text saying what is wrong (rule 5).");
		assert.ok(localize("modfile.cannotread", "(cannot read)").trim().length > 0);
	});

	it("named: every icon-only button has a tooltip that starts with a verb, and a matching aria-label", () => {
		const problems: string[] = [];
		for (const [page, html] of Object.entries(pages)) {
			for (const button of buttonsIn(html).filter(b => b.iconOnly)) {
				const where = `#${button.id} in the ${page} toolbar`;
				if (!button.title) {
					problems.push(`${where} has no title. Draw it with iconButtonHtml and give its action a tooltip (rule 4).`);
					continue;
				}
				if (button.ariaLabel !== button.title) {
					problems.push(`${where} has aria-label "${button.ariaLabel}" but title "${button.title}". They must match (rule 4).`);
				}
				const verb = button.title.split(/\s/)[0];
				if (!tooltipVerbs.includes(verb)) {
					problems.push(`${where} has the tooltip "${button.title}". Start it with one of ` +
						`${tooltipVerbs.join(", ")}, saying what a click does (rule 4).`);
				}
			}
		}
		assert.deepStrictEqual(problems, []);
	});

	it("named: a shortcut is in the tooltip", () => {
		const problems = actionIds
			.filter(id => actions[id].shortcut !== undefined)
			.filter(id => !(actions[id].tooltip ?? "").includes(`(${actions[id].shortcut})`))
			.map(id => `${id} has the shortcut ${actions[id].shortcut}, but its tooltip "${actions[id].tooltip}" ` +
				`does not mention it. Add "(${actions[id].shortcut})" to the tooltip (rule 4).`);
		assert.deepStrictEqual(problems, []);
	});

	it("state visible: every toggle changes its icon or has the pressed style", () => {
		const problems = actionIds
			.filter(id => actions[id].state !== undefined)
			.filter(id => {
				const icons = iconsOf(actions[id]);
				const changesIcon = icons.length === 2 && icons[0] !== icons[1];
				return !changesIcon && actions[id].stateStyle === undefined;
			})
			.map(id => `${id} is a toggle that looks the same on and off. Give it an { on, off } icon pair ` +
				`or a stateStyle (rule 3).`);
		assert.deepStrictEqual(problems, []);
	});

	it("state visible: the pressed style changes more than opacity", () => {
		const css = fs.readFileSync(path.join(root, "resource/common.css"), "utf8");
		const rule = /button\[aria-pressed="true"\]:not\(\[disabled\]\)\s*\{([^}]*)\}/.exec(css);
		assert.ok(rule, "common.css needs a button[aria-pressed=\"true\"]:not([disabled]) rule for toggles with stateStyle \"pressed\" (rule 3).");
		assert.ok(/background|box-shadow|border/.test(rule[1]),
			"The pressed style has to change the background or border, not only opacity (rule 3).");
		assert.ok(/div\.checkbox\.checked\s*\{[^}]*color:/.test(css),
			"common.css needs the div.checkbox.checked rule that draws the check for stateStyle \"checkmark\" (rule 3).");
	});

	it("state visible: a toggle is rendered with its state attribute", () => {
		const problems: string[] = [];
		for (const id of actionIds) {
			const a = actions[id];
			if (a.state === undefined || a.tooltipKey === undefined) {
				continue;
			}
			for (const on of [false, true]) {
				const html = iconButtonHtml(id, localize, { domId: id, on });
				if (!html.includes(`${a.state}="${on}"`)) {
					problems.push(`${id} rendered ${on ? "on" : "off"} does not carry ${a.state}="${on}" (rule 3).`);
				}
			}
		}
		assert.deepStrictEqual(problems, []);
	});

	it("stays put: icon buttons sit in the action group, in the registry's order, in every preview", () => {
		const problems: string[] = [];
		for (const [page, html] of Object.entries(pages)) {
			if (page === "registry") {
				continue;
			}
			const group = actionGroupOf(html);
			if (group.length === 0) {
				problems.push(`The ${page} toolbar has no .${toolbarActionsClass} group. Draw its buttons with actionGroupHtml (rule 6).`);
				continue;
			}
			const positions = group.map(id => actionGroupOrder.indexOf(id as IconActionId));
			for (let i = 0; i < group.length; i++) {
				if (positions[i] < 0) {
					problems.push(`${group[i]} is in the ${page} action group but not in actionGroupOrder (rule 6).`);
				} else if (i > 0 && positions[i] < positions[i - 1]) {
					problems.push(`In the ${page} toolbar ${group[i]} comes after ${group[i - 1]}, against actionGroupOrder (rule 6).`);
				}
			}
		}
		assert.deepStrictEqual(problems, []);
	});

	it("stays put: the focus tree draws the same buttons with and without warnings", () => {
		assert.deepStrictEqual(actionGroupOf(pages["focus tree without warnings"]), actionGroupOf(pages["focus tree"]),
			"A focus tree without warnings disables its warning buttons rather than dropping them (rule 6).");
	});

	it("stays put: a button that is not always on screen says when it is", () => {
		const conditional = new Set(["clearTrace", "openFile", "search", "scanReferences", "modFileError"]);
		const problems = actionIds
			.filter(id => conditional.has(id) && actions[id].shownWhen === undefined)
			.map(id => `${id} is only shown sometimes. Write the condition in its shownWhen (rule 6).`);
		assert.deepStrictEqual(problems, []);
	});

	it("locales: every registry tooltip is translated in every locale", () => {
		const keys = new Set<string>();
		for (const id of actionIds) {
			for (const key of [actions[id].tooltipKey, actions[id].tooltipOnKey]) {
				if (key !== undefined) {
					keys.add(key);
				}
			}
		}
		keys.add("modfile.cannotread");
		const problems: string[] = [];
		for (const locale of ["en", "ko", "ru", "zh-cn"]) {
			const source = fs.readFileSync(path.join(root, "i18n", `${locale}.ts`), "utf8");
			for (const key of keys) {
				if (!source.includes(`"${key}":`)) {
					problems.push(`i18n/${locale}.ts has no "${key}". Add the translation.`);
				}
			}
		}
		assert.deepStrictEqual(problems, []);
	});
});
