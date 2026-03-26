"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
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
let selectedExprs = (_a = (0, common_1.getState)().selectedExprs) !== null && _a !== void 0 ? _a : [];
let selectedFocusTreeIndex = Math.min(focusTrees.length - 1, (_b = (0, common_1.getState)().selectedFocusTreeIndex) !== null && _b !== void 0 ? _b : 0);
let allowBranches = undefined;
let conditions = undefined;
let checkedFocuses = {};
function showCustomTitlebars() {
    var _a;
    return (_a = (0, common_1.getState)().showCustomTitlebars) !== null && _a !== void 0 ? _a : true;
}
function showFocusOverlays() {
    var _a;
    return (_a = (0, common_1.getState)().showFocusOverlays) !== null && _a !== void 0 ? _a : true;
}
function showInlayWindows() {
    var _a;
    return (_a = (0, common_1.getState)().showInlayWindows) !== null && _a !== void 0 ? _a : false;
}
function getSelectedInlayWindowIds() {
    var _a;
    return (_a = (0, common_1.getState)().selectedInlayWindowIds) !== null && _a !== void 0 ? _a : {};
}
function getSelectedInlayWindowId(focusTree) {
    var _a;
    const selected = getSelectedInlayWindowIds()[focusTree.id];
    if (focusTree.inlayWindows.some(inlay => inlay.id === selected)) {
        return selected;
    }
    return (_a = focusTree.inlayWindows[0]) === null || _a === void 0 ? void 0 : _a.id;
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
function buildContent() {
    var _a, _b, _c;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const focusCheckState = (_a = (0, common_1.getState)().checkedFocuses) !== null && _a !== void 0 ? _a : {};
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
        const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs, ...selectedExprs];
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
        const minX = (_c = (_b = (0, lodash_1.minBy)(Object.values(focusPosition), 'x')) === null || _b === void 0 ? void 0 : _b.x) !== null && _c !== void 0 ? _c : 0;
        const leftPadding = gridbox.position.x._value - Math.min(minX * window.xGridSize, 0);
        const focusTreeContent = yield (0, gridboxcommon_1.renderGridBoxCommon)(Object.assign(Object.assign({}, gridbox), { position: Object.assign(Object.assign({}, gridbox.position), { x: (0, schema_1.toNumberLike)(leftPadding) }) }), {
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
        inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, exprs, styleTable);
        renderInlayInspector(focusTree, exprs);
        (0, common_1.subscribeNavigators)();
        setupCheckedFocuses(focuses, focusTree);
        applyCustomTitlebarVisibility();
        applyFocusOverlayVisibility();
    });
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
        const conditionExprs = dedupeConditionExprs(focusTree.conditionExprs.concat(focusTree.inlayConditionExprs)).filter(e => e.scopeName !== '' ||
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
            return styleTable.name('focus-icon-' + (0, styletable_1.normalizeForStyle)(iconName !== null && iconName !== void 0 ? iconName : '-empty'));
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
            var _a;
            const fp = focustree.focuses[p];
            const classNames2 = (_a = fp === null || fp === void 0 ? void 0 : fp.inAllowBranch.map(v => 'inbranch_' + v).join(' ')) !== null && _a !== void 0 ? _a : '';
            connections.push({
                target: p,
                targetType: 'parent',
                style: style,
                classNames: classNames + ' ' + classNames2,
            });
        });
    }
    focus.exclusive.forEach(e => {
        var _a;
        const fe = focustree.focuses[e];
        const classNames2 = (_a = fe === null || fe === void 0 ? void 0 : fe.inAllowBranch.map(v => 'inbranch_' + v).join(' ')) !== null && _a !== void 0 ? _a : '';
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
    var _a, _b;
    const focusCheckState = (_a = (0, common_1.getState)().checkedFocuses) !== null && _a !== void 0 ? _a : {};
    for (const focus of focuses) {
        const checkbox = document.getElementById(`checkbox-${(0, styletable_1.normalizeForStyle)(focus.id)}`);
        if (checkbox) {
            if (focusTree.conditionExprs.some(e => e.scopeName === '' && e.nodeContent === 'has_completed_focus = ' + focus.id)) {
                checkbox.checked = !!focusCheckState[focus.id];
                const checkboxItem = new checkbox_1.Checkbox(checkbox);
                checkedFocuses[focus.id] = checkboxItem;
                checkbox.addEventListener('change', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
                    yield buildContent();
                    const newCheckbox = document.getElementById(`checkbox-${(0, styletable_1.normalizeForStyle)(focus.id)}`);
                    if (newCheckbox) {
                        const rect = newCheckbox.getBoundingClientRect();
                        const newLeft = rect.left, newTop = rect.top;
                        window.scrollBy(newLeft - oldLeft, newTop - oldTop);
                    }
                    retriggerSearch();
                }));
            }
            else {
                (_b = checkbox.parentElement) === null || _b === void 0 ? void 0 : _b.remove();
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
function renderInlayWindows(focusTree, exprs, styleTable) {
    var _a, _b, _c;
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
    const markerClass = styleTable.style('focus-inlay-window-marker', () => `
        position: absolute;
        min-width: 160px;
        min-height: 70px;
        padding: 8px 12px;
        box-sizing: border-box;
        border: 1px dashed var(--vscode-textLink-foreground);
        background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-textLink-foreground) 18%);
        color: var(--vscode-foreground);
        z-index: 5;
        cursor: pointer;
    `);
    const titleClass = styleTable.style('focus-inlay-window-marker-title', () => `
        font-weight: bold;
        margin-bottom: 4px;
    `);
    const activeSlotsText = selectedInlayWindow.scriptedImages.slice(0, 3).map(slot => {
        var _a;
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        return `${slot.id}: ${(_a = activeOption === null || activeOption === void 0 ? void 0 : activeOption.gfxName) !== null && _a !== void 0 ? _a : '-'}`;
    }).join('<br/>');
    return `<div
        class="navigator ${markerClass}"
        start="${(_a = selectedInlayWindow.token) === null || _a === void 0 ? void 0 : _a.start}"
        end="${(_b = selectedInlayWindow.token) === null || _b === void 0 ? void 0 : _b.end}"
        file="${selectedInlayWindow.file}"
        style="left:${selectedInlayWindow.position.x}px;top:${selectedInlayWindow.position.y}px;"
        title="${selectedInlayWindow.id}">
            <div class="${titleClass}">${selectedInlayWindow.id}</div>
            <div>${(_c = selectedInlayWindow.windowName) !== null && _c !== void 0 ? _c : ''}</div>
            <div>${activeSlotsText}</div>
        </div>`;
}
function getActiveInlayOption(options, exprs) {
    for (const option of options) {
        if ((0, condition_1.applyCondition)(option.condition, exprs)) {
            return option;
        }
    }
    return undefined;
}
function renderInlayInspector(focusTree, exprs) {
    var _a, _b, _c, _d, _e;
    const inlayInspector = document.getElementById('inlay-inspector');
    if (!inlayInspector) {
        return;
    }
    if (!showInlayWindows()) {
        inlayInspector.style.display = 'none';
        inlayInspector.innerHTML = '';
        return;
    }
    const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
    const selectedInlayWindow = focusTree.inlayWindows.find(inlay => inlay.id === selectedInlayWindowId);
    if (!selectedInlayWindow) {
        inlayInspector.style.display = 'none';
        inlayInspector.innerHTML = '';
        return;
    }
    inlayInspector.style.display = 'block';
    const visible = (0, condition_1.applyCondition)(selectedInlayWindow.visible, exprs);
    const slotSections = selectedInlayWindow.scriptedImages.map(slot => {
        var _a, _b;
        const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
        const optionRows = slot.gfxOptions.map(option => {
            var _a, _b, _c, _d;
            const active = (activeOption === null || activeOption === void 0 ? void 0 : activeOption.gfxName) === option.gfxName;
            const navigationFile = (_a = option.gfxFile) !== null && _a !== void 0 ? _a : option.file;
            return `<div
                class="navigator inlay-inspector-row${active ? ' active' : ''}"
                start="${(option.gfxFile ? undefined : (_b = option.token) === null || _b === void 0 ? void 0 : _b.start)}"
                end="${(option.gfxFile ? undefined : (_c = option.token) === null || _c === void 0 ? void 0 : _c.end)}"
                file="${navigationFile}"
                style="padding:6px 8px;border:1px solid var(--vscode-panel-border);margin-bottom:6px;${active ? 'background: var(--vscode-list-activeSelectionBackground);' : ''}">
                    <div><strong>${option.gfxName}</strong>${active ? ' (active)' : ''}</div>
                    <div>${(0, condition_1.conditionToString)(option.condition)}</div>
                    <div>${(_d = option.gfxFile) !== null && _d !== void 0 ? _d : option.file}</div>
                </div>`;
        }).join('');
        return `<div style="margin-bottom:14px;">
            <div class="navigator" start="${(_a = slot.token) === null || _a === void 0 ? void 0 : _a.start}" end="${(_b = slot.token) === null || _b === void 0 ? void 0 : _b.end}" file="${slot.file}" style="font-weight:bold;margin-bottom:6px;cursor:pointer;">${slot.id}</div>
            ${optionRows}
        </div>`;
    }).join('');
    const buttonSections = selectedInlayWindow.scriptedButtons.map(button => {
        var _a, _b;
        return `<div style="padding:6px 0;border-top:1px solid var(--vscode-panel-border);">
        <div class="navigator" start="${(_a = button.token) === null || _a === void 0 ? void 0 : _a.start}" end="${(_b = button.token) === null || _b === void 0 ? void 0 : _b.end}" file="${button.file}" style="font-weight:bold;cursor:pointer;">${button.id}</div>
        <div>${button.available ? (0, condition_1.conditionToString)(button.available) : (0, i18n_1.feLocalize)('TODO', 'No available trigger')}</div>
    </div>`;
    }).join('');
    inlayInspector.innerHTML = `
        <div class="navigator" start="${(_a = selectedInlayWindow.token) === null || _a === void 0 ? void 0 : _a.start}" end="${(_b = selectedInlayWindow.token) === null || _b === void 0 ? void 0 : _b.end}" file="${selectedInlayWindow.file}" style="cursor:pointer;">
            <div style="font-size:16px;font-weight:bold;">${selectedInlayWindow.id}</div>
            <div>${(_c = selectedInlayWindow.windowName) !== null && _c !== void 0 ? _c : ''}</div>
            <div>${selectedInlayWindow.file}</div>
        </div>
        <div class="navigator" start="${(_d = selectedInlayWindow.token) === null || _d === void 0 ? void 0 : _d.start}" end="${(_e = selectedInlayWindow.token) === null || _e === void 0 ? void 0 : _e.end}" file="${selectedInlayWindow.file}" style="margin:12px 0;padding:8px;border:1px solid var(--vscode-panel-border);cursor:pointer;">
            <div><strong>visible</strong>: ${visible ? 'true' : 'false'}</div>
            <div>${(0, condition_1.conditionToString)(selectedInlayWindow.visible)}</div>
        </div>
        <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">Scripted images</div>
        ${slotSections || '<div>No scripted images.</div>'}
        <div style="font-size:13px;font-weight:bold;margin:16px 0 8px;">Scripted buttons</div>
        ${buttonSections || '<div>No scripted buttons.</div>'}
    `;
    (0, common_1.subscribeNavigators)();
}
let retriggerSearch = () => { };
window.addEventListener('load', (0, common_1.tryRun)(function () {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
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
            showInlayWindowsElement.checked = showInlayWindows();
            showInlayWindowsElement.addEventListener('change', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
                (0, common_1.setState)({ showInlayWindows: showInlayWindowsElement.checked });
                yield buildContent();
                retriggerSearch();
            }));
        }
        // Focuses
        const focusesElement = document.getElementById('focuses');
        if (focusesElement) {
            focusesElement.value = selectedFocusTreeIndex.toString();
            focusesElement.addEventListener('change', () => {
                selectedFocusTreeIndex = parseInt(focusesElement.value);
                (0, common_1.setState)({ selectedFocusTreeIndex });
                updateSelectedFocusTree(true);
            });
        }
        const inlayWindowsElement = document.getElementById('inlay-windows');
        if (inlayWindowsElement) {
            inlayWindowsElement.addEventListener('change', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
                const focusTree = focusTrees[selectedFocusTreeIndex];
                setSelectedInlayWindowId(focusTree, inlayWindowsElement.value);
                yield buildContent();
                retriggerSearch();
            }));
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
                conditions.selectedValues$.subscribe((selection) => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
                    yield buildContent();
                    retriggerSearch();
                }));
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
        yield buildContent();
        (0, common_1.scrollToState)();
    });
}));
//# sourceMappingURL=focustree.js.map