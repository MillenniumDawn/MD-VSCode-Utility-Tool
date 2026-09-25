import * as assert from 'assert';
import { parseHoi4File, resolveScriptVariables } from '../hoiformat/hoiparser';
import { convertNodeToJson } from '../hoiformat/schema';
import { GuiFile, guiFileSchema } from '../hoiformat/gui';
import { buildFocusTreeLayout, focusTreeGridBoxFor, standardFocusTreeLayout } from '../previewdef/focustree/layout';

function parseGui(text: string) {
    return convertNodeToJson<GuiFile>(resolveScriptVariables(parseHoi4File(text)), guiFileSchema);
}

// The parts of Millennium Dawn's interface/nationalfocusview.gui the layout reads, as the mod writes
// them: quoted names and sprites, a quoted "UP", mixed-case keys, and a second `grid` gridbox outside
// `tree > grid_window`, which is not the focus grid.
const mdGui = `guiTypes = {
	containerWindowType = {
		name = "nationalfocusview"
		position = { x=-3 y=78 }
		containerWindowType = {
			name = "tree"
			position = { x=0 y=47 }
			containerWindowType = {
				name = "grid_window"
				position = { x=0 y=0 }
				gridboxtype = {
					name = "grid"
					position = { x = 50 y = 50 }
					slotsize = { width = 1 height = 1 }
					format = "UP"
				}
				containerWindowType = {
					name = "continuous_focus_window"
					position = { x=0 y=0 }
					size = { width = 770 height = 380 }
					margin = { top = 13 left = 0 bottom = 13 right = 13}
				}
			}
		}
		containerWindowType = {
			name = "continuous_window"
			gridboxtype = {
				name = "grid"
				position = { x = 7 y = 9 }
			}
		}
	}
	containerWindowType = {
		name = "national_focus_item"
		position = { x=0 y=0 }
		size = { width = 165 height = 128 }
		buttonType = {
			name = "bg"
			quadTextureSprite ="GFX_technology_unavailable_item_bg"
			position = { x= 5 y = 40 }
		}
		buttonType = {
			name = "symbol"
			position = { x = 5 y = -44 }
			quadTextureSprite = "GFX_goal_unknown"
			centerposition = yes
			Orientation = CENTER
		}
		iconType = {
		    name = "overlay"
		    position = { x = -9 y = -28 }
		    alwaystransparent = yes
		}
		instantTextboxType = {
			name = "name"
			position = { x = 15 y = 58 }
			font = "hoi_16mbs"
			maxWidth = 147
			maxHeight = 20
			format = center
		}
	}
	containerWindowType = {
		name = "national_focus_exclusive_item"
		position = { x=-5 y=28 }
		size = { width = 1 height = 12 }
		iconType = { name = "link1" position = { x = 16 y = 10 } spriteType = "GFX_focus_exclusive_line1" frame = 1 }
		iconType = { name = "left" spriteType = "GFX_focus_link_exclusive" frame = 2 }
		iconType = { name = "right" spriteType = "GFX_focus_link_exclusive" frame = 3 }
		iconType = { name = "mid" spriteType = "GFX_focus_link_exclusive" frame = 1 }
	}
	positionType = { name = "focus_spacing" position = { x = 96 y = 130 } }
	positionType = { name = "national_focus_center" position = { x = 130 y = 32 } }
	positionType = { name = "link_begin" position = { x = 80 y = 64 } }
	positionType = { name = "link_end" position = { x = 80  y = 0 } }
	positionType = { name = "exclusive_offset" position = { x = 172 y = 24 } }
	positionType = { name = "exclusive_offset_left" position = { x = 12 y = 24 } }
	positionType = { name = "exclusive_positioning" position = { x = 2 y = 0 } }
}`;

describe('previewdef/focustree/layout', () => {
    it('reads the game layout as the standard one', () => {
        const layout = buildFocusTreeLayout([parseGui(mdGui)]);
        assert.deepStrictEqual({ ...layout, mode: 'standard' }, standardFocusTreeLayout);
        assert.strictEqual(layout.mode, 'gui');
    });

    it('keeps every standard value when the file declares none of them', () => {
        const layout = buildFocusTreeLayout([parseGui('guiTypes = { containerWindowType = { name = "unrelated" } }')]);
        assert.deepStrictEqual({ ...layout, mode: 'standard' }, standardFocusTreeLayout);
        assert.deepStrictEqual({ ...buildFocusTreeLayout([]), mode: 'standard' }, standardFocusTreeLayout);
    });

    it('sizes the continuous focus box from continuous_focus_window', () => {
        const gui = (size: string) => `guiTypes = { containerWindowType = {
            name = "nationalfocusview"
            containerWindowType = {
                name = "tree"
                containerWindowType = {
                    name = "grid_window"
                    containerWindowType = { name = "continuous_focus_window" ${size} }
                }
            }
        } }`;
        assert.deepStrictEqual(buildFocusTreeLayout([parseGui(gui('size = { width = 600 height = 300 }'))]).continuous, { width: 600, height: 300 });
        assert.deepStrictEqual(buildFocusTreeLayout([parseGui(gui('size = { width = 500 }'))]).continuous, { width: 500, height: 380 });
        assert.deepStrictEqual(buildFocusTreeLayout([parseGui(gui('size = { width = 100%% height = 200 }'))]).continuous, { width: 770, height: 200 });
        assert.deepStrictEqual(buildFocusTreeLayout([parseGui(gui(''))]).continuous, standardFocusTreeLayout.continuous);
        assert.deepStrictEqual(standardFocusTreeLayout.continuous, { width: 770, height: 380 });
    });

    it('takes the spacing and the grid from the file, resolving @constants', () => {
        const layout = buildFocusTreeLayout([parseGui(`@spacing_x = 110
guiTypes = {
	containerWindowType = {
		name = "nationalfocusview"
		containerWindowType = {
			name = "tree"
			containerWindowType = {
				name = "grid_window"
				gridboxtype = { name = "grid" position = { x = 70 y = 40 } format = "UP" }
			}
		}
	}
	positionType = { name = "focus_spacing" position = { x = @spacing_x y = 140 } }
}`)]);
        assert.deepStrictEqual(layout.spacing, { x: 110, y: 140 });
        assert.deepStrictEqual(layout.grid, { x: 70, y: 40 });
        const gridBox = focusTreeGridBoxFor(layout);
        assert.strictEqual(gridBox.slotsize?.width?._value, 110);
        assert.strictEqual(gridBox.slotsize?.height?._value, 140);
        assert.strictEqual(gridBox.position?.x?._value, 70);
    });

    it('takes the way the tree grows from the grid format', () => {
        for (const [written, format] of [['"DOWN"', 'down'], ['left', 'left'], ['RIGHT', 'right'], ['center', 'up']] as const) {
            const layout = buildFocusTreeLayout([parseGui(mdGui.replace('format = "UP"', `format = ${written}`))]);
            assert.strictEqual(layout.format, format);
            assert.strictEqual(focusTreeGridBoxFor(layout).format?._name, format);
        }
        assert.strictEqual(focusTreeGridBoxFor(standardFocusTreeLayout).format?._name, 'up');
    });

    it('moves the focus layers by how far the file moves them from the game layout', () => {
        const moved = mdGui
            .replace('position = { x = 5 y = -44 }', 'position = { x = 5 y = -34 }')
            .replace('position = { x= 5 y = 40 }', 'position = { x= 11 y = 45 }')
            .replace('position = { x = -9 y = -28 }', 'position = { x = -4 y = -30 }')
            .replace('position = { x = 15 y = 58 }', 'position = { x = 19 y = 50 }');
        const item = buildFocusTreeLayout([parseGui(moved)]).item;
        assert.deepStrictEqual(item, {
            iconOffsetX: 0,
            iconOffsetY: -8,
            titlebarOffsetX: 6,
            titlebarTop: 75,
            overlayOffsetX: 5,
            overlayOffsetY: -5,
            textOffsetX: 4,
            textTop: 77,
        });
    });

    it('moves the prerequisite line ends and the exclusive link', () => {
        const moved = mdGui
            .replace('name = "link_begin" position = { x = 80 y = 64 }', 'name = "link_begin" position = { x = 80 y = 74 }')
            .replace('name = "link_end" position = { x = 80  y = 0 }', 'name = "link_end" position = { x = 80  y = -6 }')
            .replace('name = "exclusive_offset" position = { x = 172 y = 24 }', 'name = "exclusive_offset" position = { x = 172 y = 30 }');
        const layout = buildFocusTreeLayout([parseGui(moved)]);
        assert.deepStrictEqual(layout.links, { parent: { x: 0, y: 10 }, child: { x: 0, y: -6 } });
        assert.strictEqual(layout.exclusive.offsetY, 6);
        assert.strictEqual(layout.exclusive.startX, 0);
        assert.strictEqual(layout.exclusive.endX, 0);
    });

    it('moves the exclusive link ends sideways from exclusive_offset, exclusive_offset_left and the item x', () => {
        const moved = mdGui
            .replace('name = "exclusive_offset" position = { x = 172 y = 24 }', 'name = "exclusive_offset" position = { x = 180 y = 24 }')
            .replace('name = "exclusive_offset_left" position = { x = 12 y = 24 }', 'name = "exclusive_offset_left" position = { x = 8 y = 24 }')
            .replace('position = { x=-5 y=28 }', 'position = { x=-3 y=28 }');
        const exclusive = buildFocusTreeLayout([parseGui(moved)]).exclusive;
        assert.strictEqual(exclusive.startX, 10);
        assert.strictEqual(exclusive.endX, -2);
        assert.strictEqual(exclusive.offsetY, 0);
    });

    it('takes the exclusive link sprites and 1 based frames from the file', () => {
        const moved = mdGui
            .replace('spriteType = "GFX_focus_exclusive_line1" frame = 1', 'spriteType = "GFX_my_line" frame = 2')
            .replace('name = "mid" spriteType = "GFX_focus_link_exclusive" frame = 1', 'name = "mid" spriteType = "GFX_my_mid"');
        const sprites = buildFocusTreeLayout([parseGui(moved)]).exclusive.sprites;
        assert.strictEqual(sprites.lineGfx, 'GFX_my_line');
        assert.strictEqual(sprites.lineFrame, 1);
        assert.strictEqual(sprites.midGfx, 'GFX_my_mid');
        assert.strictEqual(sprites.midFrame, 0);
        assert.strictEqual(sprites.leftFrame, 1);
        assert.strictEqual(sprites.rightFrame, 2);
    });
});
