"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./util/common");
const dropdown_1 = require("./util/dropdown");
const lodash_1 = require("lodash");
const gridboxcommon_1 = require("../src/util/hoi4gui/gridboxcommon");
const styletable_1 = require("../src/util/styletable");
const condition_1 = require("../src/hoiformat/condition");
const schema_1 = require("../src/hoiformat/schema");
const i18n_1 = require("./util/i18n");
const mios = window.mios;
const mioHeaderTexts = window.mioHeaderTexts ?? {};
const mioFrameAvailable = !!window.mioFrameAvailable;
const mioTreeHeader = window.mioTreeHeader ?? { x: 0, y: 11, w: 945, h: 24, flavorX: 0, flavorY: 0 };
let selectedExprs = (0, common_1.getState)().selectedExprs ?? [];
let selectedMioIndex = Math.min(mios.length - 1, (0, common_1.getState)().selectedMioIndex ?? 0);
let showIncludedTraits = (0, common_1.getState)().showIncludedTraits ?? true;
let showFrame = false;
let conditions = undefined;
async function buildContent() {
    const miopreviewplaceholder = document.getElementById('miopreviewplaceholder');
    const styleTable = new styletable_1.StyleTable();
    const mio = mios[selectedMioIndex];
    const renderedTrait = window.renderedTrait[mio.id];
    const allTraits = Object.values(mio.traits);
    const allowBranchOptionsValue = {};
    const exprs = selectedExprs;
    Object.values(mio.traits).forEach(trait => {
        if (trait.hasVisible) {
            allowBranchOptionsValue[trait.id] = (0, condition_1.applyCondition)(trait.visible, exprs);
        }
    });
    const gridbox = window.gridBox;
    const xGridSize = window.xGridSize;
    const traitPosition = {};
    calculateTraitVisible(mio, allowBranchOptionsValue);
    const visibleTraits = showIncludedTraits ? allTraits : allTraits.filter(t => t.sourceMioId === mio.id);
    const traitGrixBoxItems = visibleTraits.map(trait => traitToGridItem(trait, mio, allowBranchOptionsValue, traitPosition)).filter((v) => !!v);
    const minX = (0, lodash_1.minBy)(Object.values(traitPosition), 'x')?.x ?? 0;
    const baseLeft = gridbox.position.x._value - Math.min(minX * xGridSize, 0);
    const leftPadding = baseLeft;
    const traitPreviewContent = await (0, gridboxcommon_1.renderGridBoxCommon)({ ...gridbox, position: { ...gridbox.position, x: (0, schema_1.toNumberLike)(leftPadding) } }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        styleTable,
        items: (0, common_1.arrayToMap)(traitGrixBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(renderedTrait[item.id].replace('{{position}}', item.gridX + ', ' + item.gridY)),
        cornerPosition: 0.5,
    });
    const headers = mioHeaderTexts[mio.id] ?? [];
    const gridHeaderHtml = renderGridHeaderTexts(headers, leftPadding, xGridSize, mioTreeHeader.y);
    const gridHeaderWrapper = gridHeaderHtml
        ? `<div id="mio-grid-header" style="position:relative; height:${mioTreeHeader.y + mioTreeHeader.h}px; width:100%;">${gridHeaderHtml}</div>`
        : '';
    miopreviewplaceholder.innerHTML = gridHeaderWrapper + traitPreviewContent + styleTable.toStyleElement(window.styleNonce);
    const frameTreeHeaderSlot = document.getElementById('mio-frame-tree-header');
    if (frameTreeHeaderSlot) {
        frameTreeHeaderSlot.innerHTML = renderFrameHeaderTexts(headers, mioTreeHeader);
    }
    applyFrameState();
    (0, common_1.subscribeNavigators)();
}
function renderHeaderLabel(h, left, top) {
    const display = h.resolved || h.text || '';
    const keyBadge = h.text && h.text !== h.resolved ? ` <span style="opacity:0.6;font-size:10px;">[${escapeHtml(h.text)}]</span>` : '';
    return `<div style="position:absolute; left:${left}px; top:${top}px; transform:translateX(-50%); text-align:center; font-weight:bold; color:#d4c068; font-size:13px; white-space:nowrap; pointer-events:none; z-index:4;">
        ${escapeHtml(display)}${keyBadge}
    </div>`;
}
function renderGridHeaderTexts(headers, leftPadding, xGridSize, topY) {
    if (headers.length === 0) {
        return '';
    }
    return headers.map(h => {
        const left = leftPadding + h.x * xGridSize + xGridSize / 2;
        return renderHeaderLabel(h, left, topY);
    }).join('');
}
function renderFrameHeaderTexts(headers, info) {
    if (headers.length === 0) {
        return '';
    }
    return headers.map(h => {
        const left = info.flavorX + h.x;
        const top = info.flavorY;
        return renderHeaderLabel(h, left, top);
    }).join('');
}
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function applyFrameState() {
    const frame = document.getElementById('mio-frame');
    const frameSlot = document.getElementById('mio-frame-slot');
    const content = document.getElementById('miopreviewcontent');
    const placeholder = document.getElementById('miopreviewplaceholder');
    if (!placeholder || !content) {
        return;
    }
    if (showFrame && frame && frameSlot) {
        if (placeholder.parentElement !== frameSlot) {
            frameSlot.appendChild(placeholder);
        }
        frame.style.display = 'block';
        content.style.display = 'none';
    }
    else {
        if (placeholder.parentElement !== content) {
            content.appendChild(placeholder);
        }
        if (frame) {
            frame.style.display = 'none';
        }
        content.style.display = '';
    }
}
function calculateTraitVisible(mio, allowBranchOptionsValue) {
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
function updateSelectedMio(clearCondition) {
    const mio = mios[selectedMioIndex];
    const conditionExprs = mio.conditionExprs;
    const conditionContainerElement = document.getElementById('condition-container');
    if (conditionContainerElement) {
        conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
    }
    if (conditions) {
        conditions.select.innerHTML = `<span class="value"></span>
            ${conditionExprs.map(option => `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`).join('')}`;
        conditions.selectedValues$.next(clearCondition ? [] : selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
    }
}
function getTraitPosition(trait, positionByFocusId, mio, traitStack = []) {
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
    let position = { x: trait.x, y: trait.y };
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
function traitToGridItem(trait, mio, allowBranchOptionsValue, positionByTraitId) {
    if (allowBranchOptionsValue[trait.id] === false) {
        return undefined;
    }
    const connections = [];
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
window.addEventListener('load', (0, common_1.tryRun)(async function () {
    // Mio selection
    const mioSelect = document.getElementById('mios');
    if (mioSelect) {
        mioSelect.value = selectedMioIndex.toString();
        mioSelect.addEventListener('change', () => {
            selectedMioIndex = parseInt(mioSelect.value);
            (0, common_1.setState)({ selectedMioIndex });
            updateSelectedMio(true);
        });
    }
    // Conditions
    const conditionsElement = document.getElementById('conditions');
    if (conditionsElement) {
        conditions = new dropdown_1.DivDropdown(conditionsElement, true);
        conditions.selectedValues$.next(selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        conditions.selectedValues$.subscribe(async (selection) => {
            selectedExprs = selection.map(selection => {
                const index = selection.indexOf('!|');
                if (index === -1) {
                    return {
                        scopeName: '',
                        nodeContent: selection,
                    };
                }
                else {
                    return {
                        scopeName: selection.substring(0, index),
                        nodeContent: selection.substring(index + 2),
                    };
                }
            });
            (0, common_1.setState)({ selectedExprs });
            await buildContent();
        });
    }
    // Zoom
    const contentElement = document.getElementById('miopreviewcontent');
    (0, common_1.enableZoom)(contentElement, 0, 40);
    // Toggle inherited traits
    const showIncludedTraitsCheckbox = document.getElementById('show-included-traits');
    if (showIncludedTraitsCheckbox) {
        showIncludedTraitsCheckbox.checked = showIncludedTraits;
        showIncludedTraitsCheckbox.addEventListener('change', async () => {
            showIncludedTraits = showIncludedTraitsCheckbox.checked;
            (0, common_1.setState)({ showIncludedTraits });
            await buildContent();
        });
    }
    // Toggle game frame
    const showFrameCheckbox = document.getElementById('show-frame');
    if (showFrameCheckbox) {
        if (!mioFrameAvailable) {
            showFrameCheckbox.disabled = true;
            const tooltip = (0, i18n_1.feLocalize)('miopreview.frameunavailable', 'industrial_organization_detail.gui not found in mod/HOI4.');
            showFrameCheckbox.title = tooltip;
            const wrapper = showFrameCheckbox.nextElementSibling;
            if (wrapper?.classList.contains('checkbox-container-out')) {
                wrapper.style.opacity = '0.4';
                wrapper.style.pointerEvents = 'none';
                wrapper.title = tooltip;
            }
            const frameLabel = document.querySelector('label[for="show-frame"]');
            if (frameLabel) {
                frameLabel.title = tooltip;
                frameLabel.style.opacity = '0.4';
            }
        }
        showFrameCheckbox.checked = showFrame;
        showFrameCheckbox.addEventListener('change', async () => {
            showFrame = mioFrameAvailable && showFrameCheckbox.checked;
            await buildContent();
        });
    }
    updateSelectedMio(false);
    await buildContent();
    (0, common_1.scrollToState)();
}));
//# sourceMappingURL=miopreview.js.map