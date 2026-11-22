import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../util/fileloader";
import * as imagecache from "../../../../util/image/imagecache";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import { getSpriteTypes } from "../../../../hoiformat/spritetype";
import { isFocusGfxFile, loadFocusIconCatalog } from "../../../../previewdef/focusiconcatalog/loader";
import { handOver } from "../../host";

type Source = "mod" | "parent" | "vanilla";

// One file per source, as the game would load it: what a source holds, and the text of each .gfx.
interface World {
	files: Record<string, { source: Source; text: string }>;
	setting?: string[];
	descriptor?: string[];
}

function useWorld(world: World): void {
	handOver({ workspace: { getConfiguration: () => ({ focusIconCatalogGfxFiles: world.setting ?? [] }) as any } });
	mock.method(fileloader, "listFilesFromModOrHOI4", async (folder: string) =>
		Object.keys(world.files)
			.filter(file => file.startsWith(folder + "/"))
			.map(file => file.substring(folder.length + 1)));
	mock.method(fileloader, "getDescriptorFocusIconGfx", async () => world.descriptor ?? []);
	mock.method(fileloader, "getFilePathFromModOrHOI4", async (path: string, options?: fileloader.FileSourceOptions) => {
		const file = world.files[path];
		if (!file) {
			return undefined;
		}
		const wanted: Source = options?.mod === false ? "vanilla" : options?.workspace === false ? "parent" : options?.hoi4 === false ? "mod" : file.source;
		return file.source === wanted || (options === undefined) ? { path } : undefined;
	});
	mock.method(imagecache, "getGfxSpriteMap", async (path: string) => {
		const text = world.files[path]?.text ?? "";
		return Object.fromEntries(getSpriteTypes(parseHoi4File(text, "")).map(sprite => [sprite.name, sprite]));
	});
}

const vanillaGoals = `spriteTypes = {
	spriteType = { name = "GFX_goal_generic_industry" texturefile = "gfx/interface/goals/industry.dds" }
	spriteType = { name = "GFX_goal_generic_industry_shine" texturefile = "gfx/interface/goals/industry.dds" }
	SpriteType = { name = GFX_goal_overridden texturefile = gfx/interface/goals/vanilla.dds }
}`;

describe("previewdef/focusiconcatalog/loader", () => {
	afterEach(() => mock.restoreAll());

	it("takes a .gfx for a focus icon file when its name mentions goals or focuses", () => {
		assert.ok(isFocusGfxFile("interface/goals.gfx"));
		assert.ok(isFocusGfxFile("interface/MD/MD_Focus_Icons.gfx"));
		assert.ok(!isFocusGfxFile("interface/ideas.gfx"));
		assert.ok(!isFocusGfxFile("interface/goals.gui"));
	});

	it("reads goals.gfx, every focus-named file and the configured ones, and lists each sprite once", async () => {
		useWorld({
			files: {
				"interface/goals.gfx": { source: "vanilla", text: vanillaGoals },
				"interface/ideas.gfx": { source: "vanilla", text: `spriteTypes = { spriteType = { name = GFX_idea_x texturefile = a.dds } }` },
				"interface/MD_focus_ROM.gfx": { source: "mod", text: `spriteTypes = {
					spriteType = { name = "GFX_MD_ROM_army" texturefile = "gfx/interface/goals/ROM/army.dds" noOfFrames = 2 }
					spriteType = { name = "GFX_goal_overridden" texturefile = "gfx/interface/goals/mod.dds" }
				}` },
				"interface/parent_goals.gfx": { source: "parent", text: `spriteTypes = { spriteType = { name = GFX_parent_icon texturefile = p.dds } }` },
				"interface/custom/extra_icons.gfx": { source: "mod", text: `spriteTypes = { spriteType = { name = GFX_extra texturefile = e.dds } }` },
			},
			setting: ["interface/custom/extra_icons.gfx"],
		});

		const { icons, gfxFiles } = await loadFocusIconCatalog();
		assert.deepStrictEqual(icons.map(icon => icon.name), [
			"GFX_extra",
			"GFX_goal_generic_industry",
			"GFX_goal_generic_industry_shine",
			"GFX_goal_overridden",
			"GFX_MD_ROM_army",
			"GFX_parent_icon",
		].sort((a, b) => a.localeCompare(b)));

		const byName = new Map(icons.map(icon => [icon.name, icon]));
		// The mod's file is read first, so its copy of a name the game also defines wins.
		assert.strictEqual(byName.get("GFX_goal_overridden")!.source, "mod");
		assert.strictEqual(byName.get("GFX_goal_overridden")!.texture, "gfx/interface/goals/mod.dds");
		assert.strictEqual(byName.get("GFX_parent_icon")!.source, "parent");
		assert.strictEqual(byName.get("GFX_MD_ROM_army")!.frames, 2);
		assert.strictEqual(byName.get("GFX_goal_generic_industry_shine")!.shine, true);
		assert.strictEqual(byName.get("GFX_goal_generic_industry")!.shine, false);
		assert.ok(byName.get("GFX_MD_ROM_army")!.start !== undefined);
		assert.ok(!byName.has("GFX_idea_x"));

		assert.deepStrictEqual(gfxFiles.map(file => [file.path, file.source, file.count]), [
			["interface/MD_focus_ROM.gfx", "mod", 2],
			["interface/custom/extra_icons.gfx", "mod", 1],
			["interface/parent_goals.gfx", "parent", 1],
			["interface/goals.gfx", "vanilla", 2],
		]);
	});

	it("adds the files the mod's descriptor names in focus_icon_gfx", async () => {
		useWorld({
			files: {
				"interface/goals.gfx": { source: "vanilla", text: vanillaGoals },
				"interface/more_icons.gfx": { source: "mod", text: `spriteTypes = { spriteType = { name = GFX_more texturefile = m.dds } }` },
			},
			descriptor: ["interface/more_icons.gfx"],
		});
		const { icons } = await loadFocusIconCatalog();
		assert.ok(icons.some(icon => icon.name === "GFX_more" && icon.source === "mod"));
	});

	it("shows nothing rather than failing when no source has a focus file", async () => {
		useWorld({ files: {} });
		assert.deepStrictEqual(await loadFocusIconCatalog(), { icons: [], gfxFiles: [] });
	});
});
