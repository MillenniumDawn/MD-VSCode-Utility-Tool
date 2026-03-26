/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./webviewsrc/focustree.ts":
/*!*********************************!*\
  !*** ./webviewsrc/focustree.ts ***!
  \*********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! tslib */ "./node_modules/tslib/tslib.es6.js");
/* harmony import */ var _util_common__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./util/common */ "./webviewsrc/util/common.ts");
/* harmony import */ var _util_dropdown__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./util/dropdown */ "./webviewsrc/util/dropdown.ts");
/* harmony import */ var lodash__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! lodash */ "./node_modules/lodash/lodash.js");
/* harmony import */ var lodash__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(lodash__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _src_util_hoi4gui_gridboxcommon__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../src/util/hoi4gui/gridboxcommon */ "./src/util/hoi4gui/gridboxcommon.ts");
/* harmony import */ var _src_util_styletable__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../src/util/styletable */ "./src/util/styletable.ts");
/* harmony import */ var _src_hoiformat_condition__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../src/hoiformat/condition */ "./src/hoiformat/condition.ts");
/* harmony import */ var _src_hoiformat_schema__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../src/hoiformat/schema */ "./src/hoiformat/schema.ts");
/* harmony import */ var _util_i18n__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./util/i18n */ "./webviewsrc/util/i18n.ts");
/* harmony import */ var _util_checkbox__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./util/checkbox */ "./webviewsrc/util/checkbox.ts");
var _a, _b;










function showBranch(visibility, optionClass) {
    const elements = document.getElementsByClassName(optionClass);
    const hiddenBranches = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().hiddenBranches || {};
    if (visibility) {
        delete hiddenBranches[optionClass];
    }
    else {
        hiddenBranches[optionClass] = true;
    }
    (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ hiddenBranches: hiddenBranches });
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
let selectedExprs = (_a = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().selectedExprs) !== null && _a !== void 0 ? _a : [];
let selectedFocusTreeIndex = Math.min(focusTrees.length - 1, (_b = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().selectedFocusTreeIndex) !== null && _b !== void 0 ? _b : 0);
let allowBranches = undefined;
let conditions = undefined;
let checkedFocuses = {};
function buildContent() {
    var _a, _b, _c;
    return (0,tslib__WEBPACK_IMPORTED_MODULE_9__.__awaiter)(this, void 0, void 0, function* () {
        const focusCheckState = (_a = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().checkedFocuses) !== null && _a !== void 0 ? _a : {};
        const checkedFocusesExprs = Object.keys(focusCheckState)
            .filter(fid => focusCheckState[fid])
            .map(fid => ({ scopeName: '', nodeContent: 'has_completed_focus = ' + fid }));
        clearCheckedFocuses();
        const focustreeplaceholder = document.getElementById('focustreeplaceholder');
        const styleTable = new _src_util_styletable__WEBPACK_IMPORTED_MODULE_4__.StyleTable();
        const renderedFocus = window.renderedFocus;
        const focusTree = focusTrees[selectedFocusTreeIndex];
        const focuses = Object.values(focusTree.focuses);
        const allowBranchOptionsValue = {};
        const exprs = [{ scopeName: '', nodeContent: 'has_focus_tree = ' + focusTree.id }, ...checkedFocusesExprs, ...selectedExprs];
        focusTree.allowBranchOptions.forEach(option => {
            const focus = focusTree.focuses[option];
            allowBranchOptionsValue[option] = !focus || focus.allowBranch === undefined || (0,_src_hoiformat_condition__WEBPACK_IMPORTED_MODULE_5__.applyCondition)(focus.allowBranch, exprs);
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
        const minX = (_c = (_b = (0,lodash__WEBPACK_IMPORTED_MODULE_2__.minBy)(Object.values(focusPosition), 'x')) === null || _b === void 0 ? void 0 : _b.x) !== null && _c !== void 0 ? _c : 0;
        const leftPadding = gridbox.position.x._value - Math.min(minX * window.xGridSize, 0);
        const focusTreeContent = yield (0,_src_util_hoi4gui_gridboxcommon__WEBPACK_IMPORTED_MODULE_3__.renderGridBoxCommon)(Object.assign(Object.assign({}, gridbox), { position: Object.assign(Object.assign({}, gridbox.position), { x: (0,_src_hoiformat_schema__WEBPACK_IMPORTED_MODULE_6__.toNumberLike)(leftPadding) }) }), {
            size: { width: 0, height: 0 },
            orientation: 'upper_left'
        }, {
            styleTable,
            items: (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.arrayToMap)(focusGrixBoxItems, 'id'),
            onRenderItem: item => Promise.resolve(renderedFocus[item.id]
                .replace('{{position}}', item.gridX + ', ' + item.gridY)
                .replace('{{iconClass}}', getFocusIcon(focusTree.focuses[item.id], exprs, styleTable))),
            cornerPosition: 0.5,
        });
        focustreeplaceholder.innerHTML = focusTreeContent + styleTable.toStyleElement(window.styleNonce);
        (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.subscribeNavigators)();
        setupCheckedFocuses(focuses, focusTree);
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
        const conditionExprs = focusTree.conditionExprs.filter(e => e.scopeName !== '' ||
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
    const warnings = document.getElementById('warnings');
    if (warnings) {
        warnings.value = focusTree.warnings.length === 0 ? (0,_util_i18n__WEBPACK_IMPORTED_MODULE_7__.feLocalize)('worldmap.warnings.nowarnings', 'No warnings.') :
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
        if (offset.trigger !== undefined && (0,_src_hoiformat_condition__WEBPACK_IMPORTED_MODULE_5__.applyCondition)(offset.trigger, exprs)) {
            position.x += offset.x;
            position.y += offset.y;
        }
    }
    positionByFocusId[focus.id] = position;
    return position;
}
function getFocusIcon(focus, exprs, styleTable) {
    for (const icon of focus.icon) {
        if ((0,_src_hoiformat_condition__WEBPACK_IMPORTED_MODULE_5__.applyCondition)(icon.condition, exprs)) {
            const iconName = icon.icon;
            return styleTable.name('focus-icon-' + (0,_src_util_styletable__WEBPACK_IMPORTED_MODULE_4__.normalizeForStyle)(iconName !== null && iconName !== void 0 ? iconName : '-empty'));
        }
    }
    return styleTable.name('focus-icon-' + (0,_src_util_styletable__WEBPACK_IMPORTED_MODULE_4__.normalizeForStyle)('-empty'));
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
    const focusCheckState = (_a = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().checkedFocuses) !== null && _a !== void 0 ? _a : {};
    for (const focus of focuses) {
        const checkbox = document.getElementById(`checkbox-${(0,_src_util_styletable__WEBPACK_IMPORTED_MODULE_4__.normalizeForStyle)(focus.id)}`);
        if (checkbox) {
            if (focusTree.conditionExprs.some(e => e.scopeName === '' && e.nodeContent === 'has_completed_focus = ' + focus.id)) {
                checkbox.checked = !!focusCheckState[focus.id];
                const checkboxItem = new _util_checkbox__WEBPACK_IMPORTED_MODULE_8__.Checkbox(checkbox);
                checkedFocuses[focus.id] = checkboxItem;
                checkbox.addEventListener('change', () => (0,tslib__WEBPACK_IMPORTED_MODULE_9__.__awaiter)(this, void 0, void 0, function* () {
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
                    (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ checkedFocuses: focusCheckState });
                    const rect = checkbox.getBoundingClientRect();
                    const oldLeft = rect.left, oldTop = rect.top;
                    yield buildContent();
                    const newCheckbox = document.getElementById(`checkbox-${(0,_src_util_styletable__WEBPACK_IMPORTED_MODULE_4__.normalizeForStyle)(focus.id)}`);
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
let retriggerSearch = () => { };
window.addEventListener('load', (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.tryRun)(function () {
    return (0,tslib__WEBPACK_IMPORTED_MODULE_9__.__awaiter)(this, void 0, void 0, function* () {
        // Focuses
        const focusesElement = document.getElementById('focuses');
        if (focusesElement) {
            focusesElement.value = selectedFocusTreeIndex.toString();
            focusesElement.addEventListener('change', () => {
                selectedFocusTreeIndex = parseInt(focusesElement.value);
                (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ selectedFocusTreeIndex });
                updateSelectedFocusTree(true);
            });
        }
        // Allow branch
        if (!useConditionInFocus) {
            const hiddenBranches = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().hiddenBranches || {};
            for (const key in hiddenBranches) {
                showBranch(false, key);
            }
            const allowBranchesElement = document.getElementById('allowbranch');
            if (allowBranchesElement) {
                allowBranches = new _util_dropdown__WEBPACK_IMPORTED_MODULE_1__.DivDropdown(allowBranchesElement, true);
                allowBranches.selectAll();
                const allValues = allowBranches.selectedValues$.value;
                allowBranches.selectedValues$.next(allValues.filter(v => !hiddenBranches[v]));
                let oldSelection = allowBranches.selectedValues$.value;
                allowBranches.selectedValues$.subscribe(selection => {
                    const showBranches = (0,lodash__WEBPACK_IMPORTED_MODULE_2__.difference)(selection, oldSelection);
                    showBranches.forEach(s => showBranch(true, s));
                    const hideBranches = (0,lodash__WEBPACK_IMPORTED_MODULE_2__.difference)(oldSelection, selection);
                    hideBranches.forEach(s => showBranch(false, s));
                    oldSelection = selection;
                    const hiddenBranches = (0,lodash__WEBPACK_IMPORTED_MODULE_2__.difference)(allValues, selection);
                    (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ hiddenBranches });
                });
            }
        }
        // Searchbox
        const searchbox = document.getElementById('searchbox');
        let currentNavigatedIndex = 0;
        let oldSearchboxValue = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().searchboxValue || '';
        let searchedFocus = search(oldSearchboxValue, false);
        searchbox.value = oldSearchboxValue;
        const searchboxChangeFunc = function () {
            const searchboxValue = this.value.toLowerCase();
            if (oldSearchboxValue !== searchboxValue) {
                currentNavigatedIndex = 0;
                searchedFocus = search(searchboxValue);
                oldSearchboxValue = searchboxValue;
                (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ searchboxValue });
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
                conditions = new _util_dropdown__WEBPACK_IMPORTED_MODULE_1__.DivDropdown(conditionsElement, true);
                conditions.selectedValues$.next(selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
                conditions.selectedValues$.subscribe((selection) => (0,tslib__WEBPACK_IMPORTED_MODULE_9__.__awaiter)(this, void 0, void 0, function* () {
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
                    (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ selectedExprs });
                    yield buildContent();
                    retriggerSearch();
                }));
            }
        }
        // Zoom
        const contentElement = document.getElementById('focustreecontent');
        (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.enableZoom)(contentElement, 0, 40);
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
        (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.scrollToState)();
    });
}));


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			loaded: false,
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/chunk loaded */
/******/ 	(() => {
/******/ 		var deferred = [];
/******/ 		__webpack_require__.O = (result, chunkIds, fn, priority) => {
/******/ 			if(chunkIds) {
/******/ 				priority = priority || 0;
/******/ 				for(var i = deferred.length; i > 0 && deferred[i - 1][2] > priority; i--) deferred[i] = deferred[i - 1];
/******/ 				deferred[i] = [chunkIds, fn, priority];
/******/ 				return;
/******/ 			}
/******/ 			var notFulfilled = Infinity;
/******/ 			for (var i = 0; i < deferred.length; i++) {
/******/ 				var [chunkIds, fn, priority] = deferred[i];
/******/ 				var fulfilled = true;
/******/ 				for (var j = 0; j < chunkIds.length; j++) {
/******/ 					if ((priority & 1 === 0 || notFulfilled >= priority) && Object.keys(__webpack_require__.O).every((key) => (__webpack_require__.O[key](chunkIds[j])))) {
/******/ 						chunkIds.splice(j--, 1);
/******/ 					} else {
/******/ 						fulfilled = false;
/******/ 						if(priority < notFulfilled) notFulfilled = priority;
/******/ 					}
/******/ 				}
/******/ 				if(fulfilled) {
/******/ 					deferred.splice(i--, 1)
/******/ 					var r = fn();
/******/ 					if (r !== undefined) result = r;
/******/ 				}
/******/ 			}
/******/ 			return result;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/node module decorator */
/******/ 	(() => {
/******/ 		__webpack_require__.nmd = (module) => {
/******/ 			module.paths = [];
/******/ 			if (!module.children) module.children = [];
/******/ 			return module;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"focustree": 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		__webpack_require__.O.j = (chunkId) => (installedChunks[chunkId] === 0);
/******/ 		
/******/ 		// install a JSONP callback for chunk loading
/******/ 		var webpackJsonpCallback = (parentChunkLoadingFunction, data) => {
/******/ 			var [chunkIds, moreModules, runtime] = data;
/******/ 			// add "moreModules" to the modules object,
/******/ 			// then flag all "chunkIds" as loaded and fire callback
/******/ 			var moduleId, chunkId, i = 0;
/******/ 			if(chunkIds.some((id) => (installedChunks[id] !== 0))) {
/******/ 				for(moduleId in moreModules) {
/******/ 					if(__webpack_require__.o(moreModules, moduleId)) {
/******/ 						__webpack_require__.m[moduleId] = moreModules[moduleId];
/******/ 					}
/******/ 				}
/******/ 				if(runtime) var result = runtime(__webpack_require__);
/******/ 			}
/******/ 			if(parentChunkLoadingFunction) parentChunkLoadingFunction(data);
/******/ 			for(;i < chunkIds.length; i++) {
/******/ 				chunkId = chunkIds[i];
/******/ 				if(__webpack_require__.o(installedChunks, chunkId) && installedChunks[chunkId]) {
/******/ 					installedChunks[chunkId][0]();
/******/ 				}
/******/ 				installedChunks[chunkId] = 0;
/******/ 			}
/******/ 			return __webpack_require__.O(result);
/******/ 		}
/******/ 		
/******/ 		var chunkLoadingGlobal = self["webpackChunkmillennium_dawn_hoi4_utilities"] = self["webpackChunkmillennium_dawn_hoi4_utilities"] || [];
/******/ 		chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
/******/ 		chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, chunkLoadingGlobal.push.bind(chunkLoadingGlobal));
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module depends on other loaded chunks and execution need to be delayed
/******/ 	var __webpack_exports__ = __webpack_require__.O(undefined, ["common"], () => (__webpack_require__("./webviewsrc/focustree.ts")))
/******/ 	__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
/******/ 	
/******/ })()
;
//# sourceMappingURL=focustree.js.map