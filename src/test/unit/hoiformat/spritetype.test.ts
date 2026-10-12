import * as assert from "assert";
import { parseHoi4File } from "../../../hoiformat/hoiparser";
import { getSpriteTypes } from "../../../hoiformat/spritetype";
import { parse } from "../hoi";

const sprite = (name: string, texturefile: string, noofframes = 1) => ({ name, texturefile, noofframes, token: undefined });

describe("hoiformat/spritetype", () => {
	describe("getSpriteTypes", () => {
		it("reads every kind of sprite, block by block, in the case the game files use", () => {
			const sprites = getSpriteTypes(
				parse(`
					spriteTypes = {
						spriteType = { name = "GFX_goal_generic" texturefile = "gfx/interface/goals/goal_generic.dds" }
						SpriteType = { name = GFX_flag_strip textureFile = "gfx/flags/strip.dds" noOfFrames = 4 }
						corneredTileSpriteType = {
							name = "GFX_tile"
							texturefile = "gfx/tile.dds"
							size = { x = 32 y = 24 }
							borderSize = { x = 4 y = 6 }
						}
						frameAnimatedSpriteType = { name = "GFX_glow" texturefile = "gfx/glow.dds" noOfFrames = 12 }
						textSpriteType = { name = "GFX_text_icon" texturefile = "gfx/text_icon.dds" }
						progressbartype = { name = "GFX_bop_bar" textureFile1 = "gfx/bar_fill.dds" textureFile2 = "gfx/bar_empty.dds" }
						corneredTileSpriteType = { name = "GFX_tile_plain" texturefile = "gfx/plain.dds" }
					}
					spriteTypes = {
						spriteType = { name = "GFX_second_block" texturefile = "gfx/second.dds" }
					}
				`),
			);

			assert.deepStrictEqual(sprites, [
				sprite("GFX_goal_generic", "gfx/interface/goals/goal_generic.dds"),
				sprite("GFX_flag_strip", "gfx/flags/strip.dds", 4),
				sprite("GFX_glow", "gfx/glow.dds", 12),
				sprite("GFX_text_icon", "gfx/text_icon.dds"),
				// A progress bar is drawn as its fill texture.
				sprite("GFX_bop_bar", "gfx/bar_fill.dds"),
				{ ...sprite("GFX_tile", "gfx/tile.dds"), size: { x: 32, y: 24 }, bordersize: { x: 4, y: 6 } },
				{ ...sprite("GFX_tile_plain", "gfx/plain.dds"), size: { x: 100, y: 100 }, bordersize: { x: 0, y: 0 } },
				sprite("GFX_second_block", "gfx/second.dds"),
			]);
		});

		it("skips a sprite without a name or without a texture", () => {
			const sprites = getSpriteTypes(
				parse(`
					spriteTypes = {
						spriteType = { name = "GFX_no_texture" }
						spriteType = { texturefile = "gfx/no_name.dds" }
						progressbartype = { name = "GFX_no_fill" textureFile2 = "gfx/bar_empty.dds" }
						corneredTileSpriteType = { name = "GFX_tile_no_texture" }
						corneredTileSpriteType = { texturefile = "gfx/no_name.dds" }
					}
				`),
			);
			assert.deepStrictEqual(sprites, []);
		});

		it("finds no sprites in a file without spriteTypes", () => {
			assert.deepStrictEqual(getSpriteTypes(parse("guiTypes = { }")), []);
		});

		it("points each sprite at the name it was given in the file", () => {
			const source = 'spriteTypes = { spriteType = { name = "GFX_a" texturefile = "a.dds" } progressbartype = { name = GFX_b textureFile1 = "b.dds" } }';
			const tokens = getSpriteTypes(parseHoi4File(source)).map((s) => s.token);
			assert.deepStrictEqual(
				tokens.map((token) => token && source.slice(token.start, token.end)),
				['"GFX_a"', "GFX_b"],
			);
		});
	});
});
