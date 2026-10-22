import * as assert from "assert";
import { mock } from "node:test";
import { GuiFile, guiFileSchema } from "../../../../hoiformat/gui";
import { parseHoi4File, resolveScriptVariables } from "../../../../hoiformat/hoiparser";
import { convertNodeToJson } from "../../../../hoiformat/schema";
import { buildFocusTreePayload } from "../../../../previewdef/focustree/contentbuilder";
import * as titlebar from "../../../../previewdef/focustree/titlebar";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import * as imagecache from "../../../../util/image/imagecache";
import * as localisationIndex from "../../../../util/localisationIndex";
import { handOver } from "../../host";
import { shape } from "../../markup";

const file = "common/national_focus/test.txt";

function configure(settings: Record<string, unknown>): void {
	handOver({ workspace: { getConfiguration: () => settings } });
	refreshFeatureFlags();
}

async function build(tree: Record<string, unknown>) {
	const loader = { file, load: async () => ({ result: { focusTrees: [tree], gfxFiles: [], overlayGfxFiles: [] } }) };
	const payload = await buildFocusTreePayload(loader as never, undefined, { resolveIcons: false });
	assert.ok(payload);
	return payload;
}

const focus = (extra: Record<string, unknown> = {}) => ({
	id: "focus_a", x: 0, y: 0, icon: [{ icon: "GFX_focus_a" }], text: undefined, textIcon: undefined, overlay: undefined,
	token: { start: 0, end: 10 }, file, ...extra,
});
const tree = (extra: Record<string, unknown> = {}) => ({
	id: "test_tree", focuses: { focus_a: focus() }, inlayWindows: [], inlayWindowRefs: [], warnings: [], allowBranchOptions: [], ...extra,
});

describe("previewdef/focustree contentbuilder", () => {
	beforeEach(() => {
		configure({});
		// Neither reads a file or an index here: the titlebar styles are empty and every sprite is 8 by 8.
		mock.method(titlebar, "loadFocusTitlebarStyles", async () => ({}));
		mock.method(imagecache, "getSpriteByGfxName", async () => ({ width: 8, height: 8, frames: [] }));
	});

	afterEach(() => {
		mock.restoreAll();
		configure({});
	});

	describe("inlay slot", () => {
		const gfxFile = "interface/slots.gfx";
		const plainId = "leader_slot";
		// Four characters that end a class attribute or an element, each of them in a name once quoted.
		const hostileId = 'a"b<c></style>';

		async function inlayWindow(slotId: string): Promise<string> {
			const gui = convertNodeToJson<GuiFile>(resolveScriptVariables(parseHoi4File(`guiTypes = {
				containerWindowType = {
					name = "slot_window"
					position = { x = 0 y = 0 }
					size = { width = 100 height = 100 }
					iconType = { name = "slot" spriteType = "GFX_slot" position = { x = 10 y = 10 } }
				}
			}`)), guiFileSchema);
			const guiWindow = gui.guitypes[0]!.containerwindowtype[0]!;
			(guiWindow.icontype[0] as { name: string }).name = slotId;
			const slot = {
				id: slotId, file,
				gfxOptions: [{ gfxName: "GFX_slot", gfxFile, file, condition: { scopeName: "", nodeContent: "" } }],
			};
			const inlay = {
				id: "inlay", file, token: undefined, windowName: "slot_window", guiWindow, internal: true, visible: true,
				position: { x: 0, y: 0 }, scriptedImages: [slot], scriptedButtons: [], conditionExprs: [],
			};
			return (await build(tree({ inlayWindows: [inlay] }))).renderedInlayWindows["inlay"]!;
		}

		it("names the class to swap in after the slot, spelled so no id can close the attribute", async () => {
			assert.ok((await inlayWindow(plainId)).includes("{{inlay_slot_class:leader_slot}}"));
			const hostile = await inlayWindow(hostileId);
			assert.ok(hostile.includes("{{inlay_slot_class:a%22b%3Cc%3E%3C%2Fstyle%3E}}"), hostile);
			assert.ok(!hostile.includes(hostileId), hostile);
		});

		it("keeps distinct slot ids from sharing a placeholder", async () => {
			const first = (await inlayWindow("a-b")).match(/\{\{inlay_slot_class:[^}]*\}\}/)?.[0];
			const second = (await inlayWindow("a_45b")).match(/\{\{inlay_slot_class:[^}]*\}\}/)?.[0];
			assert.ok(first);
			assert.ok(second);
			assert.notStrictEqual(first, second);
		});

		it("gains no element or attribute from a slot named with a quote, a bracket and </style>", async () => {
			assert.deepStrictEqual(shape(await inlayWindow(hostileId)), shape(await inlayWindow(plainId)));
		});
	});

	describe("localised label", () => {
		const hostile = '"quoted" <img src=x onerror=1> </style>';
		// [where the label comes from, the localisation of the focus itself, the focus's text key]
		const sources: [string, Record<string, string>, string | undefined][] = [
			["the focus id", {}, undefined],
			["the focus text", { focus_a: "focus_a" }, "FOCUS_A_TEXT"],
		];

		let labels: Record<string, string> = {};

		beforeEach(() => {
			configure({ localisationIndex: true });
			mock.method(localisationIndex, "getLocalisedTextQuick", async (key: string) => labels[key] ?? key);
		});

		for (const [name, own, text] of sources) {
			async function label(localised: string): Promise<string> {
				labels = { ...own, [text ?? "focus_a"]: localised };
				return (await build(tree({ focuses: { focus_a: focus({ text }) } }))).renderedFocus["focus_a"]!;
			}

			it(`escapes the label taken from ${name} and leaves its spaces to wrap`, async () => {
				assert.ok((await label("Two words")).includes("<br/>Two words"));
				assert.ok((await label(hostile)).includes("<br/>&quot;quoted&quot; &lt;img src=x onerror=1&gt; &lt;/style&gt;"));
			});

			it(`gains no element or attribute from a label taken from ${name}`, async () => {
				assert.deepStrictEqual(shape(await label(hostile)), shape(await label("Plain")));
			});
		}
	});
});
