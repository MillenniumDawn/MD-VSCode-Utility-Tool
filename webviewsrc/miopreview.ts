import { getState, setState, arrayToMap, subscribeNavigators, scrollToState, tryRun, enableZoom, initCommon } from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { minBy, maxBy } from "lodash";
import { renderGridBoxCommon, GridBoxItem, GridBoxConnection } from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable } from "../src/util/styletable";
import { applyCondition, ConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { vscode } from "./util/vscode";
import { Mio, MioTrait } from "../src/previewdef/mio/schema";

let mios: Mio[] = (window as any).mios;

let selectedExprs: ConditionItem[] = getState().selectedExprs ?? [];
let selectedMioIndex: number = Math.min(mios.length - 1, getState().selectedMioIndex ?? 0);
let showIncludedTraits: boolean = getState().showIncludedTraits ?? true;
let showGrid: boolean = getState().showGrid ?? false;
let conditions: DivDropdown | undefined = undefined;

initCommon();

async function buildContent() {
    const miopreviewplaceholder = document.getElementById('miopreviewplaceholder') as HTMLDivElement;

    const styleTable = new StyleTable();
    const mio = mios[selectedMioIndex];
    const renderedTrait: Record<string, string> = (window as any).renderedTrait[mio.id];
    const allTraits = Object.values(mio.traits);

    const allowBranchOptionsValue: Record<string, boolean> = {};
    const exprs = selectedExprs;
    Object.values(mio.traits).forEach(trait => {
        if (trait.hasVisible) {
            allowBranchOptionsValue[trait.id] = applyCondition(trait.visible, exprs);
        }
    });

    const gridbox: GridBoxType = (window as any).gridBox;
    const xGridSize: number = (window as any).xGridSize;

    const traitPosition: Record<string, NumberPosition> = {};
    calculateTraitVisible(mio, allowBranchOptionsValue);
    const visibleTraits = showIncludedTraits ? allTraits : allTraits.filter(t => t.sourceMioId === mio.id);
    const traitGrixBoxItems = visibleTraits.map(trait => traitToGridItem(trait, mio, allowBranchOptionsValue, traitPosition)).filter((v): v is GridBoxItem => !!v);

    const minX = minBy(Object.values(traitPosition), 'x')?.x ?? 0;
    const baseLeft = gridbox.position.x._value - Math.min(minX * xGridSize, 0);
    const leftPadding = baseLeft;

    const traitPreviewContent = await renderGridBoxCommon({ ...gridbox, position: {...gridbox.position, x: toNumberLike(leftPadding)} }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        styleTable,
        items: arrayToMap(traitGrixBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(
            renderedTrait[item.id].replace('{{position}}', item.gridX + ', ' + item.gridY)),
        cornerPosition: 0.5,
    });

    // Column headers (tree_header_text). Server-rendered and localised per mio; each header carries
    // only its column offset (left = x * xGridSize). We wrap them in a layer anchored to the same
    // origin as the grid (leftPadding is computed above, so headers track the grid when it shifts).
    const headerHtml: string = ((window as any).renderedHeaders ?? {})[mio.id] ?? '';
    const headerTop = gridbox.position.y._value - 30;
    const headerLayer = headerHtml
        ? `<div class="${styleTable.oneTimeStyle('mio-header-layer', () => `position:absolute; left:${leftPadding}px; top:${headerTop}px;`)}">${headerHtml}</div>`
        : '';

    const gridGuideLayer = showGrid ? buildGridGuide(styleTable, gridbox, xGridSize, leftPadding, traitPosition) : '';

    miopreviewplaceholder.innerHTML = traitPreviewContent + headerLayer + gridGuideLayer + styleTable.toStyleElement((window as any).styleNonce);

    subscribeNavigators();
}

// Column grid overlay. Draws a faint vertical line at every column boundary (k = 0..10) anchored to
// the same grid origin as the traits/headers, and emphasizes the k = 10 line — the right edge of
// column 9. The in-game MIO tree window only renders columns 0..9, so any trait with x > 9 bugs out;
// this marks where that limit falls. The layer sits inside #miopreviewplaceholder so it scales with
// zoom and shifts together with the grid.
function buildGridGuide(
    styleTable: StyleTable,
    gridbox: GridBoxType,
    xGridSize: number,
    leftPadding: number,
    traitPosition: Record<string, NumberPosition>,
): string {
    const limitColumn = 10; // right edge of column 9 (valid columns are 0..9)
    const yGridSize = gridbox.slotsize?.height?._value ?? 117;
    const top = gridbox.position.y._value;
    const maxY = maxBy(Object.values(traitPosition), 'y')?.y ?? 0;
    const height = (maxY + 1) * yGridSize;

    let lines = '';
    for (let k = 0; k <= limitColumn; k++) {
        const isLimit = k === limitColumn;
        const cls = isLimit
            ? styleTable.style('mio-grid-limit', () => `position:absolute; top:0; width:2px; background:#e06c3b; opacity:0.85; pointer-events:none;`)
            : styleTable.style('mio-grid-line', () => `position:absolute; top:0; width:1px; background:#ffffff; opacity:0.12; pointer-events:none;`);
        lines += `<div class="${cls} ${styleTable.oneTimeStyle('mio-grid-x-' + k, () => `left:${k * xGridSize}px; height:${height}px;`)}"></div>`;
    }

    const label = `<div class="${styleTable.style('mio-grid-label', () => `position:absolute; top:-14px; font-size:10px; color:#e06c3b; white-space:nowrap; pointer-events:none;`)} ${styleTable.oneTimeStyle('mio-grid-label-pos', () => `left:${limitColumn * xGridSize + 4}px;`)}">x = 9 limit</div>`;

    return `<div class="${styleTable.oneTimeStyle('mio-grid-layer', () => `position:absolute; left:${leftPadding}px; top:${top}px;`)}">${lines}${label}</div>`;
}

function calculateTraitVisible(mio: Mio, allowBranchOptionsValue: Record<string, boolean>) {
    const traits = mio.traits;

    let changed = true;
    while (changed) {
        changed = false;
        for (const key in traits) {
            const trait = traits[key];
            if (trait.anyParent.length === 0 && trait.allParents.length === 0 && !trait.parent) {
                continue;
            }

            if (trait.id in allowBranchOptionsValue) {
                continue;
            }

            if (trait.parent) {
                if (trait.parent.traits.length - trait.parent.traits.filter(p => allowBranchOptionsValue[p] === false).length < trait.parent.numNeeded) {
                    allowBranchOptionsValue[trait.id] = false;
                    changed = true;
                    break;
                }

                if (trait.parent.traits.filter(p => allowBranchOptionsValue[p] === true).length >= trait.parent.numNeeded) {
                    allowBranchOptionsValue[trait.id] = true;
                    changed = true;
                    continue;
                }
            }

            if (trait.allParents.some(p => allowBranchOptionsValue[p] === false)) {
                allowBranchOptionsValue[trait.id] = false;
                changed = true;
                break;
            }

            if (trait.anyParent.some(p => allowBranchOptionsValue[p] === true)) {
                allowBranchOptionsValue[trait.id] = true;
                changed = true;
                continue;
            }
        }
    }
}

function updateSelectedMio(clearCondition: boolean) {
    const mio = mios[selectedMioIndex];

    const conditionExprs = mio.conditionExprs;

    const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
    if (conditionContainerElement) {
        conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
    }

    if (conditions) {
        conditions.select.innerHTML = `<span class="value"></span>
            ${conditionExprs.map(option =>
                `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`
            ).join('')}`;
        conditions.selectedValues$.next(clearCondition ? [] : selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
    }

}

function getTraitPosition(
    trait: MioTrait | undefined,
    positionByFocusId: Record<string, NumberPosition>,
    mio: Mio,
    traitStack: MioTrait[] = []
): NumberPosition {
    if (trait === undefined) {
        return { x: 0, y: 0 };
    }

    const cached = positionByFocusId[trait.id];
    if (cached) {
        return cached;
    }

    if (traitStack.includes(trait)) {
        return { x: 0, y: 0 };
    }

    let position: NumberPosition = { x: trait.x, y: trait.y };
    if (trait.relativePositionId !== undefined) {
        traitStack.push(trait);
        const relativeFocusPosition = getTraitPosition(mio.traits[trait.relativePositionId], positionByFocusId, mio, traitStack);
        traitStack.pop();
        position.x += relativeFocusPosition.x;
        position.y += relativeFocusPosition.y;
    }

    positionByFocusId[trait.id] = position;
    return position;
}

function traitToGridItem(
    trait: MioTrait,
    mio: Mio,
    allowBranchOptionsValue: Record<string, boolean>,
    positionByTraitId: Record<string, NumberPosition>,
): GridBoxItem | undefined {
    if (allowBranchOptionsValue[trait.id] === false) {
        return undefined;
    }

    const connections: GridBoxConnection[] = [];

    for (const parent of trait.anyParent) {
        connections.push({
            target: parent,
            targetType: 'parent',
            style: '1px dashed #88aaff',
        });
    }

    for (const parent of trait.allParents) {
        connections.push({
            target: parent,
            targetType: 'parent',
            style: '1px solid #88aaff',
        });
    }

    if (trait.parent) {
        const style = trait.parent.traits.length === trait.parent.numNeeded ? '1px solid #88aaff' : '1px dashed #88aaff';
        for (const parent of trait.parent.traits) {
            connections.push({
                target: parent,
                targetType: 'parent',
                style: style,
            });
        }
    }

    trait.exclusive.forEach(e => {
        connections.push({
            target: e,
            targetType: 'related',
            style: "1px solid red",
        });
    });

    const position = getTraitPosition(trait, positionByTraitId, mio, []);

    return {
        id: trait.id,
        htmlId: 'trait_' + trait.id,
        classNames: 'trait',
        gridX: position.x,
        gridY: position.y,
        connections,
    };
}

// In-place update pushed by LoaderPreview when the previewed file changed: refresh the globals
// buildContent renders from and the server trait-icon <style>, then redraw without a full reload
// so scroll, zoom and the selected mio / conditions survive. The toolbar controls and their load-
// time listeners are left intact (only the placeholder grid and headers are rebuilt). Falls back
// to a full reload if the DOM the swap needs is gone (e.g. the webview shows the "no mio" page).
window.addEventListener('message', tryRun(async (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || msg.type !== 'updateBody') {
        return;
    }

    const placeholder = document.getElementById('miopreviewplaceholder') as HTMLDivElement | null;
    if (!placeholder) {
        vscode.postMessage({ command: 'reload' });
        return;
    }

    if (typeof msg.styleCss === 'string') {
        const serverStyles = document.getElementById('mio-server-styles');
        if (serverStyles) {
            serverStyles.textContent = msg.styleCss;
        }
    }

    const data = msg.data ?? {};
    if (data.mios) {
        mios = data.mios;
        (window as any).mios = mios;
    }
    if (data.renderedTrait) { (window as any).renderedTrait = data.renderedTrait; }
    if (data.renderedHeaders) { (window as any).renderedHeaders = data.renderedHeaders; }
    if (data.gridBox) { (window as any).gridBox = data.gridBox; }
    if (data.xGridSize !== undefined) { (window as any).xGridSize = data.xGridSize; }

    // Clamp if the mio set shrank so buildContent never indexes an undefined mio.
    if (selectedMioIndex >= mios.length) {
        selectedMioIndex = Math.max(0, mios.length - 1);
        setState({ selectedMioIndex });
    }

    // Refresh the dropdown options (server sends the localised <option> list) and keep the selected
    // index. The <select> element and its change listener are untouched, so nothing re-binds. The
    // container is shown/hidden explicitly (block/none) so it survives the single-org boundary.
    const mioSelect = document.getElementById('mios') as HTMLSelectElement | null;
    if (mioSelect) {
        if (typeof data.mioOptionsHtml === 'string') {
            mioSelect.innerHTML = data.mioOptionsHtml;
        }
        mioSelect.value = selectedMioIndex.toString();
    }
    const mioSelectContainer = document.getElementById('mio-select-container');
    if (mioSelectContainer) {
        mioSelectContainer.style.display = mios.length <= 1 ? 'none' : 'block';
    }

    // buildContent replaces the placeholder's content, which can shift layout; pin the viewport.
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    updateSelectedMio(false);
    await buildContent();
    window.scrollTo(scrollX, scrollY);
}));

window.addEventListener('load', tryRun(async function() {
    // Mio selection
    const mioSelect = document.getElementById('mios') as HTMLSelectElement | null;
    if (mioSelect) {
        mioSelect.value = selectedMioIndex.toString();
        mioSelect.addEventListener('change', () => {
            selectedMioIndex = parseInt(mioSelect.value);
            setState({ selectedMioIndex });
            updateSelectedMio(true);
        });
    }

    // Conditions
    const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
    if (conditionsElement) {
        conditions = new DivDropdown(conditionsElement, true);
        
        conditions.selectedValues$.next(selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        conditions.selectedValues$.subscribe(async (selection) => {
            selectedExprs = selection.map<ConditionItem>(selection => {
                const index = selection.indexOf('!|');
                if (index === -1) {
                    return {
                        scopeName: '',
                        nodeContent: selection,
                    };
                } else {
                    return {
                        scopeName: selection.substring(0, index),
                        nodeContent: selection.substring(index + 2),
                    };
                }
            });

            setState({ selectedExprs });
            
            await buildContent();
        });
    }

    // Zoom
    const contentElement = document.getElementById('miopreviewcontent') as HTMLDivElement;
    enableZoom(contentElement, 0, 40);

    // Toggle inherited traits
    const showIncludedTraitsCheckbox = document.getElementById('show-included-traits') as HTMLInputElement | null;
    if (showIncludedTraitsCheckbox) {
        showIncludedTraitsCheckbox.checked = showIncludedTraits;
        showIncludedTraitsCheckbox.addEventListener('change', async () => {
            showIncludedTraits = showIncludedTraitsCheckbox.checked;
            setState({ showIncludedTraits });
            await buildContent();
        });
    }

    // Toggle column grid overlay
    const showGridCheckbox = document.getElementById('show-grid') as HTMLInputElement | null;
    if (showGridCheckbox) {
        showGridCheckbox.checked = showGrid;
        showGridCheckbox.addEventListener('change', async () => {
            showGrid = showGridCheckbox.checked;
            setState({ showGrid });
            await buildContent();
        });
    }

    updateSelectedMio(false);
    await buildContent();
    scrollToState();
}));
