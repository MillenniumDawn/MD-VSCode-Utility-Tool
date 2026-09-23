import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// The preview is reachable from the editor title bar, the editor and explorer context menus and
// a keybinding. All four are manifest-only, so nothing in the compiler notices when a command id
// is misspelled or a menu stops matching the files it is meant to match. Issue #203.

// The folders the explorer entry offers Preview on. This list restates what each provider's
// canPreview() checks, because a `when` clause cannot call into the extension -- so it is pinned
// here, and a new preview type whose folder is missing fails this test rather than going quietly
// absent from the menu.
const previewFolders = [
	"national_focus",
	"events",
	"technologies",
	"ideas",
	"decisions",
	"characters",
	"organizations",
];

describe("package.json menu contributions", () => {
	const packageJson = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "..", "..", "..", "package.json"),
			"utf8",
		),
	);
	const contributes = packageJson.contributes;
	const menus: Record<string, { command: string; when?: string; group?: string }[]> =
		contributes.menus;
	const keybindings: { command: string; key: string; mac?: string; when?: string }[] =
		contributes.keybindings;
	const commandIds: string[] = contributes.commands.map(
		(command: { command: string }) => command.command,
	);

	it("only names commands the extension contributes", () => {
		const named = [
			...Object.values(menus).flatMap(entries => entries.map(entry => entry.command)),
			...keybindings.map(binding => binding.command),
		];
		for (const command of named) {
			assert.ok(
				commandIds.includes(command),
				`${command} is used in a menu or keybinding but never contributed`,
			);
		}
	});

	it("offers the preview from the editor context menu and the explorer", () => {
		for (const menu of ["editor/title", "editor/context", "explorer/context"]) {
			const entries = menus[menu] ?? [];
			assert.ok(
				entries.some(entry => entry.command === "mdhoi4utilities.preview"),
				`${menu} does not offer the preview`,
			);
		}
	});

	it("draws the scan references icon somewhere icons are rendered", () => {
		// commandPalette never draws a command's icon, so contributing $(references) without an
		// editor/title entry meant the icon was dead weight.
		assert.ok(
			(menus["editor/title"] ?? []).some(
				entry => entry.command === "mdhoi4utilities.scanreferences",
			),
			"scanreferences carries an icon but appears in no menu that draws one",
		);
	});

	it("binds the preview to a key on both platforms", () => {
		const binding = keybindings.find(
			entry => entry.command === "mdhoi4utilities.preview",
		);
		assert.ok(binding, "the preview has no keybinding");
		assert.ok(binding!.key, "the preview keybinding has no default key");
		assert.ok(binding!.mac, "the preview keybinding has no mac key");
		assert.ok(
			binding!.when?.includes("shouldShowMdHoi4Preview"),
			"the preview keybinding fires on files that cannot be previewed",
		);
	});

	describe("the explorer entry's path match", () => {
		const entry = (menus["explorer/context"] ?? []).find(
			item => item.command === "mdhoi4utilities.preview",
		);
		const when = entry?.when ?? "";
		const source = when.split("=~ /")[1]?.replace(/\/i$/, "") ?? "";
		const pattern = new RegExp(source, "i");

		it("names exactly the folders the preview providers recognise", () => {
			const group = /\(([a-z_|]+)\)/.exec(source);
			assert.ok(group, "the explorer when clause has no folder group");
			assert.deepStrictEqual(group![1].split("|").sort(), [...previewFolders].sort());
		});

		it("matches the files the previews handle, on either path separator", () => {
			for (const file of [
				"d:\\mod\\common\\national_focus\\usa.txt",
				"/home/me/mod/common/national_focus/usa.txt",
				"mod/events/news_events.txt",
				"mod/common/technologies/infantry.txt",
				"mod/common/ideas/country.txt",
				"mod/common/decisions/political.txt",
				"mod/common/characters/USA.txt",
				"mod/common/military_industrial_organization/organizations/usa.txt",
			]) {
				assert.ok(pattern.test(file), `${file} should be previewable`);
			}
		});

		it("leaves files the previews do not handle alone", () => {
			for (const file of [
				// A category file sits one folder deeper and is not a decision file.
				"mod/common/decisions/categories/political.txt",
				"mod/history/countries/USA.txt",
				"mod/common/ideas/README.md",
				"readme.txt",
			]) {
				assert.ok(!pattern.test(file), `${file} should not be previewable`);
			}
		});

		it("offers the sprite, gui and map files by name", () => {
			for (const clause of [
				"resourceExtname == '.gfx'",
				"resourceExtname == '.gui'",
				"resourceFilename == 'default.map'",
			]) {
				assert.ok(when.includes(clause), `the explorer entry is missing ${clause}`);
			}
		});
	});
});
