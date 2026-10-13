import { localize } from '../../util/i18n';
import { definePreview } from '../definition';
import { WorldMapContainer } from "./worldmapcontainer";

export const worldMap = new WorldMapContainer();

export const worldMapPreviewDef = definePreview({
    type: 'worldmap',
    displayName: () => localize('preview.type.worldmap', 'World map (map/default.map)'),
    onPreview: () => worldMap.openPreview(),
});
