import { localize } from '../../util/i18n';
import * as vscode from 'vscode';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewProviderDef } from '../previewmanager';
import { WorldMapContainer } from "./worldmapcontainer";

export const worldMap = new WorldMapContainer();

function canPreviewWorldmap(document: vscode.TextDocument) {
    const uri = document.uri;
    return matchPathEnd(uri.toString().toLowerCase(), ['map', 'default.map']) ? 0 : undefined;
}

function onPreviewWorldmap(_document: vscode.TextDocument): Promise<void> {
    return worldMap.openPreview();
}

export const worldMapPreviewDef: PreviewProviderDef = {
    type: 'worldmap',
    displayName: () => localize('preview.type.worldmap', 'World map (map/default.map)'),
    canPreview: canPreviewWorldmap,
    onPreview: onPreviewWorldmap,
};
