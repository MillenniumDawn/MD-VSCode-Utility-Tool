import { chain } from 'lodash';
import * as vscode from 'vscode';
import { ContainerWindowType } from '../../hoiformat/gui';
import { HOIPartial } from '../../hoiformat/schema';
import { arrayToMap } from '../../util/common';
import { debug } from '../../util/debug';
import { renderStandaloneWindow } from '../../util/hoi4gui/window';
import { html, previewedFileUriScript, errorPage } from '../../util/html';
import { localize } from '../../util/i18n';
import { LoaderSession } from '../../util/loader/loader';
import { StyleTable, normalizeForStyle } from '../../util/styletable';
import { GuiFileLoader, GuiFileLoaderResult } from "./loader";

export async function renderGuiFile(loader: GuiFileLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    try {
        const session = new LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = session.loadedLoaderNames();
        debug('Loader session gui', loadedLoaders);

        const guiFiles = loadResult.result.guiFiles;
        const containerWindows = chain(guiFiles).flatMap(g => g.data.guitypes).flatMap(gt => [...gt.containerwindowtype, ...gt.windowtype]).value();
        
        if (containerWindows.length === 0) {
            const baseContent = localize('guipreview.nocontainerwindows', 'No containerwindowtype in gui file.');
            return html(webview, baseContent, [ previewedFileUriScript(uri) ], []);
        }

        const styleTable = new StyleTable();
        const baseContent = await renderGuiContainerWindows(containerWindows, styleTable, loadResult.result);

        return html(
            webview,
            baseContent,
            [
                previewedFileUriScript(uri),
                { content: 'window.containerWindowToggles = ' + JSON.stringify(makeToggleContainerWindowCheckboxes(containerWindows, styleTable)) + ';' },
                'common.js',
                'guipreview.js',
            ],
            [
                'common.css',
                'codicon.css',
                styleTable,
            ],
        );

    } catch (e) {
        return errorPage(webview, uri, e);
    }
}

async function renderGuiContainerWindows(containerWindows: HOIPartial<ContainerWindowType>[], styleTable: StyleTable, loadResult: GuiFileLoaderResult): Promise<string> {
    const gfxFiles = loadResult.gfxFiles;
    const renderedWindows = (await Promise.all(containerWindows.map(cw => renderSingleContainerWindow(cw, styleTable, gfxFiles)))).join('');

    return `
    ${renderTopBar(containerWindows.map(cw => cw.name).filter((name): name is string => name !== undefined), styleTable)}
    <div
    id="dragger"
    class="${styleTable.oneTimeStyle('dragger', () => `
        width: 100vw;
        height: 100vh;
        position: fixed;
        left:0;
        top:0;
        background: var(--vscode-editor-background);
    `)}">
    </div>
    <div
    id="mainContent"
    class="${styleTable.oneTimeStyle('mainContent', () => `
        position: absolute;
        left: 0;
        top: 0;
        margin-top: 40px;
    `)}">
        ${renderedWindows}
    </div>`;
}

function renderTopBar(folders: string[], styleTable: StyleTable): string {
    return `<div
    class="${styleTable.oneTimeStyle('folderSelectorBar', () => `
        position: fixed;
        padding-top: 9px;
        padding-left: 20px;
        width: 100%;
        height: 30px;
        top: 0;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        z-index: 10;
    `)}">
        <label for="folderSelector" class="${styleTable.oneTimeStyle('folderSelectorLabel', () => `margin-right:5px`)}">
            ${localize('guipreview.containerWindow', 'Container Window: ')}
        </label>
        <div class="select-container">
            <select
                id="folderSelector"
                type="text"
                class="${styleTable.oneTimeStyle('folderSelector', () => `min-width:200px`)}"
            >
                ${folders.map(folder => `<option value="containerwindow_${folder}">${folder}</option>`)}
            </select>
        </div>
        <button id="refresh" title="${localize('common.topbar.refresh.title', 'Refresh')}">
            <i class="codicon codicon-refresh"></i>
        </button>
        <button id="toggleVisibility" title="${localize('guipreview.topbar.toggleVisibility.title', 'Show or Hide Container Windows')}">
            <i class="codicon codicon-eye"></i>
        </button>
    </div>
    <div
    id="toggleVisibilityContent"
    class="${styleTable.oneTimeStyle('toggleVisibilityContent', () => `
        position: fixed;
        margin-top: 10px;
        width: 100%;
        height: 200px;
        top: 30px;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        z-index: 10;
        overflow: auto;
        display: none;
    `)}">
        <div id="toggleVisibilityContentInner" class="${styleTable.oneTimeStyle('toggleVisibilityContentInner', () => `
            padding-left: 20px;
        `)}">
        </div>
    </div>`;
}

async function renderSingleContainerWindow(
    containerWindow: HOIPartial<ContainerWindowType>,
    styleTable: StyleTable,
    gfxFiles: string[],
): Promise<string> {
    // The drawing itself is shared with the decision preview, which renders the window a
    // `scripted_gui` category is replaced by; only the wrapper below is this preview's own.
    const { html } = await renderStandaloneWindow(containerWindow, styleTable, gfxFiles);

    return `<div
        id="containerwindow_${containerWindow.name}"
        class="
            containerwindow
            containerwindow_${normalizeForStyle(containerWindow.name ?? '')}
            ${styleTable.style('displayNone', () => `display:none;`)}"
    >
        ${html}
    </div>`;
}

function makeToggleContainerWindowCheckboxes(containerWindows: HOIPartial<ContainerWindowType>[], styleTable: StyleTable) {
    return arrayToMap(containerWindows.map(cw => {
        return { name: cw.name ?? '', content: makeToggleContainerWindowCheckboxesRecursively(cw, styleTable, '', 0) };
    }), 'name');
}

function makeToggleContainerWindowCheckboxesRecursively(containerWindow: HOIPartial<ContainerWindowType>, styleTable: StyleTable, prefix: string, level: number): string {
    const childWindows = [...containerWindow.containerwindowtype, ...containerWindow.windowtype];
    childWindows.sort((a, b) => (a._index ?? 0) - (b._index ?? 0));
    return childWindows.map(cw => {
        const normalizedName = normalizeForStyle(cw.name ?? '');
        return `<div class="${styleTable.oneTimeStyle('level-' + level, () => 'padding-left: ' + (level * 20) + 'px;')}">
            <input
                type="checkbox"
                id="toggleContainerWindow_${prefix}${normalizedName}"
                containerWindowName="${cw.name}"
                checked="checked"
                class="toggleContainerWindowCheckbox"
            />
        </div>` + makeToggleContainerWindowCheckboxesRecursively(cw, styleTable, prefix + normalizedName + '_', level + 1);
    }).join('');
}
