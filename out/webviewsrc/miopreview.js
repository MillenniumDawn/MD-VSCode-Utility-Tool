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
let selectedExprs = (0, common_1.getState)().selectedExprs ?? [];
let selectedMioIndex = Math.min(mios.length - 1, (0, common_1.getState)().selectedMioIndex ?? 0);
let conditions = undefined;
async function buildContent() {
    const miopreviewplaceholder = document.getElementById('miopreviewplaceholder');
    const styleTable = new styletable_1.StyleTable();
    const mio = mios[selectedMioIndex];
    const renderedTrait = window.renderedTrait[mio.id];
    const traits = Object.values(mio.traits);
    const allowBranchOptionsValue = {};
    const exprs = selectedExprs;
    Object.values(mio.traits).forEach(trait => {
        if (trait.hasVisible) {
            allowBranchOptionsValue[trait.id] = (0, condition_1.applyCondition)(trait.visible, exprs);
        }
    });
    const gridbox = window.gridBox;
    const traitPosition = {};
    calculateTraitVisible(mio, allowBranchOptionsValue);
    const traitGrixBoxItems = traits.map(trait => traitToGridItem(trait, mio, allowBranchOptionsValue, traitPosition)).filter((v) => !!v);
    const minX = (0, lodash_1.minBy)(Object.values(traitPosition), 'x')?.x ?? 0;
    const leftPadding = gridbox.position.x._value - Math.min(minX * window.xGridSize, 0);
    const traitPreviewContent = await (0, gridboxcommon_1.renderGridBoxCommon)({ ...gridbox, position: { ...gridbox.position, x: (0, schema_1.toNumberLike)(leftPadding) } }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        styleTable,
        items: (0, common_1.arrayToMap)(traitGrixBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(renderedTrait[item.id].replace('{{position}}', item.gridX + ', ' + item.gridY)),
        cornerPosition: 0.5,
    });
    miopreviewplaceholder.innerHTML = traitPreviewContent + styleTable.toStyleElement(window.styleNonce);
    (0, common_1.subscribeNavigators)();
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
    const warnings = document.getElementById('warnings');
    if (warnings) {
        warnings.value = mio.warnings.length === 0 ? (0, i18n_1.feLocalize)('worldmap.warnings.nowarnings', 'No warnings.') :
            mio.warnings.map(w => `[${w.source}] ${w.text}`).join('\n');
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
    // Toggle warnings
    const showWarnings = document.getElementById('show-warnings');
    if (showWarnings) {
        const warnings = document.getElementById('warnings-container');
        showWarnings.addEventListener('click', () => {
            const visible = warnings.style.display === 'block';
            document.body.style.overflow = visible ? '' : 'hidden';
            warnings.style.display = visible ? 'none' : 'block';
        });
    }
    updateSelectedMio(false);
    await buildContent();
    (0, common_1.scrollToState)();
}));
//# sourceMappingURL=miopreview.js.map