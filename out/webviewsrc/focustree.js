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
const checkbox_1 = require("./util/checkbox");
function showBranch(visibility, optionClass) {
    const elements = document.getElementsByClassName(optionClass);
    const hiddenBranches = (0, common_1.getState)().hiddenBranches || {};
    if (visibility) {
        delete hiddenBranches[optionClass];
    }
    else {
        hiddenBranches[optionClass] = true;
    }
    (0, common_1.setState)({ hiddenBranches: hiddenBranches });
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        element.style.display = element.className.split(' ').some(b => hiddenBranches[b]) ? "none" : "block";
    }
}
;
function search(searchContent, navigate = true) {
    const focuses = document.getElementsByClassName('focus');
    const searchedFocus = [];
    let navigated = false;
    for (let i = 0; i < focuses.length; i++) {
        const focus = focuses[i];
        if (searchContent && focus.id.toLowerCase().replace(/^focus_/, '').includes(searchContent)) {
            focus.style.outline = '1px solid #E33';
            focus.style.background = 'rgba(255, 0, 0, 0.5)';
            if (navigate && !navigated) {
                focus.scrollIntoView({ block: "center", inline: "center" });
                navigated = true;
            }
            searchedFocus.push(focus);
        }
        else {
            focus.style.outlineWidth = '0';
            focus.style.background = 'transparent';
        }
    }
    return searchedFocus;
}
const useConditionInFocus = window.useConditionInFocus;
const focusTrees = window.focusTrees;
let selectedExprs = (0, common_1.getState)().selectedExprs ?? [];
let selectedInlayExprs = (0, common_1.getState)().selectedInlayExprs ?? [];
let selectedFocusTreeIndex = Math.min(focusTrees.length - 1, (0, common_1.getState)().selectedFocusTreeIndex ?? 0);
let allowBranches = undefined;
let conditions = undefined;
let inlayConditions = undefined;
let checkedFocuses = {};
function showCustomTitlebars() {
    return (0, common_1.getState)().showCustomTitlebars ?? false;
}
function showFocusOverlays() {
    return (0, common_1.getState)().showFocusOverlays ?? false;
}
function showInlayWindows() {
    return !!window.__showInlayWindows;
}
function getSelectedInlayWindowIds() {
    return (0, common_1.getState)().selectedInlayWindowIds ?? {};
}
function getSelectedInlayWindowId(focusTree) {
    const selected = getSelectedInlayWindowIds()[focusTree.id];
    if (focusTree.inlayWindows.some(inlay => inlay.id === selected)) {
        return selected;
    }
    return focusTree.inlayWindows[0]?.id;
}
function setSelectedInlayWindowId(focusTree, inlayWindowId) {
    const selectedInlayWindowIds = getSelectedInlayWindowIds();
    selectedInlayWindowIds[focusTree.id] = inlayWindowId;
    (0, common_1.setState)({ selectedInlayWindowIds });
}
function applyCustomTitlebarVisibility() {
    const visible = showCustomTitlebars();
    const elements = document.getElementsByClassName('focus-titlebar-layer');
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.dataset.hasCustomTitlebar === 'true') {
            element.style.display = visible ? 'block' : 'none';
        }
    }
}
function applyFocusOverlayVisibility() {
    const visible = showFocusOverlays();
    const elements = document.getElementsByClassName('focus-overlay-layer');
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.dataset.hasFocusOverlay === 'true') {
            element.style.display = visible ? 'block' : 'none';
        }
    }
}
async function buildContent() {
    const focusCheckState = (0, common_1.getState)().checkedFocuses ?? {};
    const checkedFocusesExprs = Object.keys(focusCheckState)
        .filter(fid => focusCheckState[fid])
        .map(fid => ({ scopeName: '', nodeContent: 'has_completed_focus = ' + fid }));
    clearCheckedFocuses();
    const focustreeplaceholder = document.getElementById('focustreeplaceholder');
    const styleTable = new styletable_1.StyleTable();
    const renderedFocus = window.renderedFocus;
    const focusTree = focusTrees[selectedFocusTreeIndex];
    const focuses = Object.values(focusTree.focuses);
    const allowBranchOptionsValue = {};
    const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs, ...selectedExprs, ...selectedInlayExprs];
    focusTree.allowBranchOptions.forEach(option => {
        const focus = focusTree.focuses[option];
        allowBranchOptionsValue[option] = !focus || focus.allowBranch === undefined || (0, condition_1.applyCondition)(focus.allowBranch, exprs);
    });
    // For synthetic trees (shared focuses), always allow branches to show them in preview
    if (focusTree.isSharedFocues) {
        focusTree.allowBranchOptions.forEach(option => {
            allowBranchOptionsValue[option] = true;
        });
    }
    const gridbox = window.gridBox;
    const focusPosition = {};
    calculateFocusAllowed(focusTree, allowBranchOptionsValue);
    const focusGrixBoxItems = focuses.map(focus => focusToGridItem(focus, focusTree, allowBranchOptionsValue, focusPosition, exprs)).filter((v) => !!v);
    const minX = (0, lodash_1.minBy)(Object.values(focusPosition), 'x')?.x ?? 0;
    const leftPadding = gridbox.position.x._value - Math.min(minX * window.xGridSize, 0);
    const focusTreeContent = await (0, gridboxcommon_1.renderGridBoxCommon)({ ...gridbox, position: { ...gridbox.position, x: (0, schema_1.toNumberLike)(leftPadding) } }, {
        size: { width: 0, height: 0 },
        orientation: 'upper_left'
    }, {
        styleTable,
        items: (0, common_1.arrayToMap)(focusGrixBoxItems, 'id'),
        onRenderItem: item => Promise.resolve(renderedFocus[item.id]
            .replace('{{position}}', item.gridX + ', ' + item.gridY)
            .replace('{{iconClass}}', getFocusIcon(focusTree.focuses[item.id], exprs, styleTable))),
        cornerPosition: 0.5,
    });
    focustreeplaceholder.innerHTML = focusTreeContent + styleTable.toStyleElement(window.styleNonce);
    const inlayWindowPlaceholder = document.getElementById('inlaywindowplaceholder');
    inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, exprs);
    (0, common_1.subscribeNavigators)();
    setupCheckedFocuses(focuses, focusTree);
    applyCustomTitlebarVisibility();
    applyFocusOverlayVisibility();
}
function calculateFocusAllowed(focusTree, allowBranchOptionsValue) {
    const focuses = focusTree.focuses;
    let changed = true;
    while (changed) {
        changed = false;
        for (const key in focuses) {
            const focus = focuses[key];
            if (focus.prerequisite.length === 0) {
                continue;
            }
            if (focus.id in allowBranchOptionsValue) {
                continue;
            }
            let allow = true;
            for (const andPrerequests of focus.prerequisite) {
                if (andPrerequests.length === 0) {
                    continue;
                }
                allow = allow && andPrerequests.some(p => allowBranchOptionsValue[p] === true);
                const deny = andPrerequests.every(p => allowBranchOptionsValue[p] === false);
                if (deny) {
                    allowBranchOptionsValue[focus.id] = false;
                    changed = true;
                    break;
                }
            }
            if (allow) {
                allowBranchOptionsValue[focus.id] = true;
                changed = true;
            }
        }
    }
}
function updateSelectedFocusTree(clearCondition) {
    const focusTree = focusTrees[selectedFocusTreeIndex];
    const continuousFocuses = document.getElementById('continuousFocuses');
    if (focusTree.continuousFocusPositionX !== undefined && focusTree.continuousFocusPositionY !== undefined) {
        continuousFocuses.style.left = (focusTree.continuousFocusPositionX - 59) + 'px';
        continuousFocuses.style.top = (focusTree.continuousFocusPositionY + 7) + 'px';
        continuousFocuses.style.display = 'block';
    }
    else {
        continuousFocuses.style.display = 'none';
    }
    if (useConditionInFocus) {
        const conditionExprs = dedupeConditionExprs(focusTree.conditionExprs).filter(e => e.scopeName !== '' ||
            (!e.nodeContent.startsWith('has_focus_tree = ') && !e.nodeContent.startsWith('has_completed_focus = ')));
        const inlayConditionExprs = dedupeConditionExprs(focusTree.inlayConditionExprs).filter(e => e.scopeName !== '' ||
            (!e.nodeContent.startsWith('has_focus_tree = ') && !e.nodeContent.startsWith('has_completed_focus = ')));
        const conditionContainerElement = document.getElementById('condition-container');
        if (conditionContainerElement) {
            conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
        }
        if (conditions) {
            conditions.select.innerHTML = `<span class="value"></span>
                ${conditionExprs.map(option => `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`).join('')}`;
            conditions.selectedValues$.next(clearCondition ? [] : selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        }
        const inlayConditionContainerElement = document.getElementById('inlay-condition-container');
        if (inlayConditionContainerElement) {
            inlayConditionContainerElement.style.display = showInlayWindows() && inlayConditionExprs.length > 0 ? 'block' : 'none';
        }
        if (inlayConditions) {
            inlayConditions.select.innerHTML = `<span class="value"></span>
                ${inlayConditionExprs.map(option => `<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ''}${option.nodeContent}</div>`).join('')}`;
            inlayConditions.selectedValues$.next(clearCondition ? [] : selectedInlayExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
        }
    }
    else {
        const allowBranchesContainerElement = document.getElementById('allowbranch-container');
        if (allowBranchesContainerElement) {
            allowBranchesContainerElement.style.display = focusTree.allowBranchOptions.length > 0 ? 'block' : 'none';
        }
        if (allowBranches) {
            allowBranches.select.innerHTML = `<span class="value"></span>
                ${focusTree.allowBranchOptions.map(option => `<div class="option" value="inbranch_${option}">${option}</div>`).join('')}`;
            allowBranches.selectAll();
        }
    }
    const inlayWindowsElement = document.getElementById('inlay-windows');
    const inlayWindowsContainerElement = document.getElementById('inlay-window-container');
    if (inlayWindowsContainerElement) {
        inlayWindowsContainerElement.style.display = focusTree.inlayWindows.length > 0 ? 'block' : 'none';
    }
    if (inlayWindowsElement) {
        inlayWindowsElement.innerHTML = focusTree.inlayWindows.map(inlay => `<option value="${inlay.id}">${inlay.id}</option>`).join('');
        const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
        if (selectedInlayWindowId) {
            inlayWindowsElement.value = selectedInlayWindowId;
            setSelectedInlayWindowId(focusTree, selectedInlayWindowId);
        }
    }
    const warnings = document.getElementById('warnings');
    if (warnings) {
        warnings.value = focusTree.warnings.length === 0 ? (0, i18n_1.feLocalize)('worldmap.warnings.nowarnings', 'No warnings.') :
            focusTree.warnings.map(w => `[${w.source}] ${w.text}`).join('\n');
    }
}
function getFocusPosition(focus, positionByFocusId, focusTree, focusStack = [], exprs) {
    if (focus === undefined) {
        return { x: 0, y: 0 };
    }
    const cached = positionByFocusId[focus.id];
    if (cached) {
        return cached;
    }
    if (focusStack.includes(focus)) {
        return { x: 0, y: 0 };
    }
    let position = { x: focus.x, y: focus.y };
    if (focus.relativePositionId !== undefined) {
        focusStack.push(focus);
        const relativeFocusPosition = getFocusPosition(focusTree.focuses[focus.relativePositionId], positionByFocusId, focusTree, focusStack, exprs);
        focusStack.pop();
        position.x += relativeFocusPosition.x;
        position.y += relativeFocusPosition.y;
    }
    for (const offset of focus.offset) {
        if (offset.trigger !== undefined && (0, condition_1.applyCondition)(offset.trigger, exprs)) {
            position.x += offset.x;
            position.y += offset.y;
        }
    }
    positionByFocusId[focus.id] = position;
    return position;
}
function getFocusIcon(focus, exprs, styleTable) {
    for (const icon of focus.icon) {
        if ((0, condition_1.applyCondition)(icon.condition, exprs)) {
            const iconName = icon.icon;
            return styleTable.name('focus-icon-' + (0, styletable_1.normalizeForStyle)(iconName ?? '-empty'));
        }
    }
    return styleTable.name('focus-icon-' + (0, styletable_1.normalizeForStyle)('-empty'));
}
function focusToGridItem(focus, focustree, allowBranchOptionsValue, positionByFocusId, exprs) {
    if (useConditionInFocus) {
        if (allowBranchOptionsValue[focus.id] === false) {
            return undefined;
        }
    }
    const classNames = focus.inAllowBranch.map(v => 'inbranch_' + v).join(' ');
    const connections = [];
    for (const prerequisites of focus.prerequisite) {
        let style;
        if (prerequisites.length > 1) {
            style = "1px dashed #88aaff";
        }
        else {
            style = "1px solid #88aaff";
        }
        prerequisites.forEach(p => {
            const fp = focustree.focuses[p];
            const classNames2 = fp?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
            connections.push({
                target: p,
                targetType: 'parent',
                style: style,
                classNames: classNames + ' ' + classNames2,
            });
        });
    }
    focus.exclusive.forEach(e => {
        const fe = focustree.focuses[e];
        const classNames2 = fe?.inAllowBranch.map(v => 'inbranch_' + v).join(' ') ?? '';
        connections.push({
            target: e,
            targetType: 'related',
            style: "1px solid red",
            classNames: classNames + ' ' + classNames2,
        });
    });
    const position = getFocusPosition(focus, positionByFocusId, focustree, [], exprs);
    return {
        id: focus.id,
        htmlId: 'focus_' + focus.id,
        classNames: classNames + ' focus',
        gridX: position.x,
        gridY: position.y,
        connections,
    };
}
function clearCheckedFocuses() {
    for (const focusId in checkedFocuses) {
        checkedFocuses[focusId].dispose();
    }
    checkedFocuses = {};
}
function setupCheckedFocuses(focuses, focusTree) {
    const focusCheckState = (0, common_1.getState)().checkedFocuses ?? {};
    for (const focus of focuses) {
        const checkbox = document.getElementById(`checkbox-${(0, styletable_1.normalizeForStyle)(focus.id)}`);
        if (checkbox) {
            if (focusTree.conditionExprs.some(e => e.scopeName === '' && e.nodeContent === 'has_completed_focus = ' + focus.id)) {
                checkbox.checked = !!focusCheckState[focus.id];
                const checkboxItem = new checkbox_1.Checkbox(checkbox);
                checkedFocuses[focus.id] = checkboxItem;
                checkbox.addEventListener('change', async () => {
                    if (checkbox.checked) {
                        for (const exclusiveFocus of focus.exclusive) {
                            const exclusiveCheckbox = checkedFocuses[exclusiveFocus];
                            if (exclusiveCheckbox) {
                                exclusiveCheckbox.input.checked = false;
                                focusCheckState[exclusiveFocus] = false;
                            }
                        }
                    }
                    focusCheckState[focus.id] = checkbox.checked;
                    (0, common_1.setState)({ checkedFocuses: focusCheckState });
                    const rect = checkbox.getBoundingClientRect();
                    const oldLeft = rect.left, oldTop = rect.top;
                    await buildContent();
                    const newCheckbox = document.getElementById(`checkbox-${(0, styletable_1.normalizeForStyle)(focus.id)}`);
                    if (newCheckbox) {
                        const rect = newCheckbox.getBoundingClientRect();
                        const newLeft = rect.left, newTop = rect.top;
                        window.scrollBy(newLeft - oldLeft, newTop - oldTop);
                    }
                    retriggerSearch();
                });
            }
            else {
                checkbox.parentElement?.remove();
            }
        }
    }
}
function dedupeConditionExprs(exprs) {
    const result = [];
    for (const expr of exprs) {
        if (!result.some(existing => existing.scopeName === expr.scopeName && existing.nodeContent === expr.nodeContent)) {
            result.push(expr);
        }
    }
    return result;
}
function renderInlayWindows(focusTree, exprs) {
    if (!showInlayWindows()) {
        return '';
    }
    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
    if (!selectedInlayWindowId) {
        return '';
    }
    const selectedInlayWindow = focusTree.inlayWindows.find(inlay => inlay.id === selectedInlayWindowId);
    if (!selectedInlayWindow || !(0, condition_1.applyCondition)(selectedInlayWindow.visible, exprs)) {
        return '';
    }
    const renderedInlayWindows = window.renderedInlayWindows ?? {};
    const template = renderedInlayWindows[selectedInlayWindow.id] ?? '';
    return selectedInlayWindow.scriptedImages.reduce((content, slot) => {
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        return content.split(`{{inlay_slot_class:${slot.id}}}`).join(activeOption ? getInlayGfxClassName(activeOption.gfxName, activeOption.gfxFile) : '');
    }, template);
}
function getActiveInlayOption(options, exprs) {
    for (const option of options) {
        if ((0, condition_1.applyCondition)(option.condition, exprs)) {
            return option;
        }
    }
    return undefined;
}
function getInlayGfxClassName(gfxName, gfxFile) {
    return 'st-inlay-gfx-' + (0, styletable_1.normalizeForStyle)((gfxFile ?? 'missing') + '-' + (gfxName ?? 'missing'));
}
let retriggerSearch = () => { };
window.addEventListener('load', (0, common_1.tryRun)(async function () {
    // Custom titlebars
    const showCustomTitlebarsElement = document.getElementById('show-custom-titlebars');
    if (showCustomTitlebarsElement) {
        showCustomTitlebarsElement.checked = showCustomTitlebars();
        showCustomTitlebarsElement.addEventListener('change', () => {
            (0, common_1.setState)({ showCustomTitlebars: showCustomTitlebarsElement.checked });
            applyCustomTitlebarVisibility();
        });
    }
    const showFocusOverlaysElement = document.getElementById('show-focus-overlays');
    if (showFocusOverlaysElement) {
        showFocusOverlaysElement.checked = showFocusOverlays();
        showFocusOverlaysElement.addEventListener('change', () => {
            (0, common_1.setState)({ showFocusOverlays: showFocusOverlaysElement.checked });
            applyFocusOverlayVisibility();
        });
    }
    const showInlayWindowsElement = document.getElementById('show-inlay-windows');
    if (showInlayWindowsElement) {
        window.__showInlayWindows = false;
        showInlayWindowsElement.checked = false;
        showInlayWindowsElement.addEventListener('change', async () => {
            window.__showInlayWindows = showInlayWindowsElement.checked;
            updateSelectedFocusTree(false);
            await buildContent();
            retriggerSearch();
        });
    }
    // Focuses
    const focusesElement = document.getElementById('focuses');
    if (focusesElement) {
        focusesElement.value = selectedFocusTreeIndex.toString();
        focusesElement.addEventListener('change', async () => {
            selectedFocusTreeIndex = parseInt(focusesElement.value);
            (0, common_1.setState)({ selectedFocusTreeIndex });
            updateSelectedFocusTree(true);
            await buildContent();
            retriggerSearch();
        });
    }
    const inlayWindowsElement = document.getElementById('inlay-windows');
    if (inlayWindowsElement) {
        inlayWindowsElement.addEventListener('change', async () => {
            const focusTree = focusTrees[selectedFocusTreeIndex];
            setSelectedInlayWindowId(focusTree, inlayWindowsElement.value);
            await buildContent();
            retriggerSearch();
        });
    }
    // Allow branch
    if (!useConditionInFocus) {
        const hiddenBranches = (0, common_1.getState)().hiddenBranches || {};
        for (const key in hiddenBranches) {
            showBranch(false, key);
        }
        const allowBranchesElement = document.getElementById('allowbranch');
        if (allowBranchesElement) {
            allowBranches = new dropdown_1.DivDropdown(allowBranchesElement, true);
            allowBranches.selectAll();
            const allValues = allowBranches.selectedValues$.value;
            allowBranches.selectedValues$.next(allValues.filter(v => !hiddenBranches[v]));
            let oldSelection = allowBranches.selectedValues$.value;
            allowBranches.selectedValues$.subscribe(selection => {
                const showBranches = (0, lodash_1.difference)(selection, oldSelection);
                showBranches.forEach(s => showBranch(true, s));
                const hideBranches = (0, lodash_1.difference)(oldSelection, selection);
                hideBranches.forEach(s => showBranch(false, s));
                oldSelection = selection;
                const hiddenBranches = (0, lodash_1.difference)(allValues, selection);
                (0, common_1.setState)({ hiddenBranches });
            });
        }
    }
    // Searchbox
    const searchbox = document.getElementById('searchbox');
    let currentNavigatedIndex = 0;
    let oldSearchboxValue = (0, common_1.getState)().searchboxValue || '';
    let searchedFocus = search(oldSearchboxValue, false);
    searchbox.value = oldSearchboxValue;
    const searchboxChangeFunc = function () {
        const searchboxValue = this.value.toLowerCase();
        if (oldSearchboxValue !== searchboxValue) {
            currentNavigatedIndex = 0;
            searchedFocus = search(searchboxValue);
            oldSearchboxValue = searchboxValue;
            (0, common_1.setState)({ searchboxValue });
        }
    };
    searchbox.addEventListener('change', searchboxChangeFunc);
    searchbox.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            const visibleSearchedFocus = searchedFocus.filter(f => f.style.display !== 'none');
            if (visibleSearchedFocus.length > 0) {
                currentNavigatedIndex = (currentNavigatedIndex + (e.shiftKey ? visibleSearchedFocus.length - 1 : 1)) % visibleSearchedFocus.length;
                visibleSearchedFocus[currentNavigatedIndex].scrollIntoView({ block: "center", inline: "center" });
            }
        }
        else {
            searchboxChangeFunc.apply(this);
        }
    });
    searchbox.addEventListener('keyup', searchboxChangeFunc);
    searchbox.addEventListener('paste', searchboxChangeFunc);
    searchbox.addEventListener('cut', searchboxChangeFunc);
    retriggerSearch = () => { searchedFocus = search(oldSearchboxValue, false); };
    // Conditions
    if (useConditionInFocus) {
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
                retriggerSearch();
            });
        }
        const inlayConditionsElement = document.getElementById('inlay-conditions');
        if (inlayConditionsElement) {
            inlayConditions = new dropdown_1.DivDropdown(inlayConditionsElement, true);
            inlayConditions.selectedValues$.next(selectedInlayExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
            inlayConditions.selectedValues$.subscribe(async (selection) => {
                selectedInlayExprs = selection.map(selection => {
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
                (0, common_1.setState)({ selectedInlayExprs });
                await buildContent();
                retriggerSearch();
            });
        }
    }
    // Zoom
    const contentElement = document.getElementById('focustreecontent');
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
    updateSelectedFocusTree(false);
    await buildContent();
    (0, common_1.scrollToState)();
}));
//# sourceMappingURL=focustree.js.map