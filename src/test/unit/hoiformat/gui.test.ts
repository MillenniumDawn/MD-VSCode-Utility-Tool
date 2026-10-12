import * as assert from "assert";
import { GuiFile, guiFileSchema } from "../../../hoiformat/gui";
import { convertNodeToJson } from "../../../hoiformat/schema";
import { parse, schemaKeys } from "../hoi";

describe("hoiformat/gui", () => {
	describe("guiFileSchema", () => {
		it("declares every field in lower case, the only case the converter looks up", () => {
			const keys = schemaKeys(guiFileSchema);
			assert.ok(keys.length > 50, `only ${keys.length} fields found`);
			assert.deepStrictEqual(keys.filter((key) => key !== key.toLowerCase()), []);
		});

		it("reads a window with everything a .gui file nests in one", () => {
			const file = convertNodeToJson<GuiFile>(
				parse(`
					guiTypes = {
						containerWindowType = {
							name = "nationalfocusview"
							Orientation = UPPER_LEFT
							origo = center
							position = { x = 0 y = 47 }
							size = { width = 100%% height = 100% min = { width = 800 height = 600 } }
							margin = { top = 13 left = 13 bottom = 24 right = 25 }
							background = { name = "Background" quadTextureSprite = "GFX_tiled_window" }
							containerWindowType = {
								name = "inner"
								iconType = { name = "icon" spriteType = "GFX_goal_unknown" frame = 2 scale = 0.5 centerPosition = yes }
								gridBoxType = { name = "grid" slotsize = { width = 96 height = 130 } format = "UP" }
							}
							windowType = { name = "legacy_window" }
							instantTextBoxType = { name = "title" font = "hoi_24header" maxWidth = 170 format = centre }
							textboxType = { name = "body" text = "FOCUS_DESC" }
							buttonType = { name = "close" quadTextureSprite = "GFX_closebutton" buttonText = "CLOSE" }
							checkboxType = { name = "toggle" }
							guiButtonType = { name = "legacy_button" }
						}
						positionType = { name = "focus_spacing" position = { x = 96 y = 130 } }
						iconType = { name = "range_bar" spriteType = "GFX_range" }
					}
				`),
				guiFileSchema,
			);

			const types = file.guitypes[0];
			const window = types?.containerwindowtype[0];
			const inner = window?.containerwindowtype[0];
			const icon = inner?.icontype[0];
			const grid = inner?.gridboxtype[0];
			const title = window?.instanttextboxtype[0];
			const close = window?.buttontype[0];

			assert.deepStrictEqual(
				{
					window: [window?.name, window?.orientation?._name, window?.origo?._name],
					position: [window?.position?.x?._value, window?.position?.y?._value],
					size: [window?.size?.width, window?.size?.height?._unit, window?.size?.min?.width?._value],
					margin: [window?.margin?.top?._value, window?.margin?.right?._value],
					background: [window?.background?.name, window?.background?.quadtexturesprite],
					icon: [icon?.name, icon?.spritetype, icon?.frame, icon?.scale, icon?.centerposition],
					grid: [grid?.name, grid?.slotsize?.height?._value, grid?.format?._name],
					title: [title?.name, title?.font, title?.maxwidth?._value, title?.format?._name],
					close: [close?.name, close?.quadtexturesprite, close?.buttontext],
					others: [
						window?.windowtype[0]?.name,
						window?.textboxtype[0]?.text,
						window?.checkboxtype[0]?.name,
						window?.guibuttontype[0]?.name,
					],
					outside: [types?.positiontype[0]?.name, types?.positiontype[0]?.position?.y?._value, types?.icontype[0]?.name],
				},
				{
					window: ["nationalfocusview", "upper_left", "center"],
					position: [0, 47],
					size: [{ _value: 100, _unit: "%%", _token: undefined }, "%", 800],
					margin: [13, 25],
					background: ["Background", "GFX_tiled_window"],
					icon: ["icon", "GFX_goal_unknown", 2, 0.5, true],
					grid: ["grid", 130, "up"],
					title: ["title", "hoi_24header", 170, "centre"],
					close: ["close", "GFX_closebutton", "CLOSE"],
					others: ["legacy_window", "FOCUS_DESC", "toggle", "legacy_button"],
					outside: ["focus_spacing", 130, "range_bar"],
				},
			);
		});
	});
});
