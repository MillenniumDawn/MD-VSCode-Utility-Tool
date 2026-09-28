import { actionGroupHtml, iconButtonHtml, Localizer } from "../toolbaricons";

// worldmapview.html names its icon buttons with `%icon:<slot>%` placeholders rather than writing
// the codicon markup itself, so the world map takes its icons and tooltips from the same table as
// every other preview. The ids are the ones webviewsrc/worldmap/topbar.ts looks up.
function toolbarSlots(localize: Localizer): Record<string, string> {
	return {
		search: iconButtonHtml("search", localize, { domId: "search" }),
		actions: actionGroupHtml({
			refresh: iconButtonHtml("refresh", localize, { domId: "refresh" }),
			saveImage: iconButtonHtml("saveImage", localize, { domId: "export" }),
			showWarnings: iconButtonHtml("showWarnings", localize, { domId: "show-warnings", on: false }),
			// Only the view modes with a file behind each region have something to open.
			openFile: iconButtonHtml("openFile", localize, {
				domId: "open",
				attributes: 'viewmode="state strategicregion supplyarea"',
			}),
		}),
	};
}

export function renderWorldMapIcons(template: string, localize: Localizer): string {
	const slots = toolbarSlots(localize);
	return template.replace(/%icon:(\w+)%/g, (placeholder, slot: string) => slots[slot] ?? placeholder);
}
