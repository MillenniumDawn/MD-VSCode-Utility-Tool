/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./webviewsrc/miopreview.ts":
/*!**********************************!*\
  !*** ./webviewsrc/miopreview.ts ***!
  \**********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! tslib */ "./node_modules/tslib/tslib.es6.js");
/* harmony import */ var _util_common__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./util/common */ "./webviewsrc/util/common.ts");
/* harmony import */ var _util_dropdown__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./util/dropdown */ "./webviewsrc/util/dropdown.ts");
/* harmony import */ var lodash__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! lodash */ "./node_modules/lodash/lodash.js");
/* harmony import */ var lodash__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(lodash__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _src_util_hoi4gui_gridboxcommon__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../src/util/hoi4gui/gridboxcommon */ "./src/util/hoi4gui/gridboxcommon.ts");
/* harmony import */ var _src_util_styletable__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../src/util/styletable */ "./src/util/styletable.ts");
/* harmony import */ var _src_hoiformat_condition__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../src/hoiformat/condition */ "./src/hoiformat/condition.ts");
/* harmony import */ var _src_hoiformat_schema__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../src/hoiformat/schema */ "./src/hoiformat/schema.ts");
/* harmony import */ var _util_i18n__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./util/i18n */ "./webviewsrc/util/i18n.ts");
var _a, _b;









const mios = window.mios;
let selectedExprs = (_a = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().selectedExprs) !== null && _a !== void 0 ? _a : [];
let selectedMioIndex = Math.min(mios.length - 1, (_b = (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.getState)().selectedMioIndex) !== null && _b !== void 0 ? _b : 0);
let conditions = undefined;
function buildContent() {
    var _a, _b;
    return (0,tslib__WEBPACK_IMPORTED_MODULE_8__.__awaiter)(this, void 0, void 0, function* () {
        const miopreviewplaceholder = document.getElementById('miopreviewplaceholder');
        const styleTable = new _src_util_styletable__WEBPACK_IMPORTED_MODULE_4__.StyleTable();
        const mio = mios[selectedMioIndex];
        const renderedTrait = window.renderedTrait[mio.id];
        const traits = Object.values(mio.traits);
        const allowBranchOptionsValue = {};
        const exprs = selectedExprs;
        Object.values(mio.traits).forEach(trait => {
            if (trait.hasVisible) {
                allowBranchOptionsValue[trait.id] = (0,_src_hoiformat_condition__WEBPACK_IMPORTED_MODULE_5__.applyCondition)(trait.visible, exprs);
            }
        });
        const gridbox = window.gridBox;
        const traitPosition = {};
        calculateTraitVisible(mio, allowBranchOptionsValue);
        const traitGrixBoxItems = traits.map(trait => traitToGridItem(trait, mio, allowBranchOptionsValue, traitPosition)).filter((v) => !!v);
        const minX = (_b = (_a = (0,lodash__WEBPACK_IMPORTED_MODULE_2__.minBy)(Object.values(traitPosition), 'x')) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0;
        const leftPadding = gridbox.position.x._value - Math.min(minX * window.xGridSize, 0);
        const traitPreviewContent = yield (0,_src_util_hoi4gui_gridboxcommon__WEBPACK_IMPORTED_MODULE_3__.renderGridBoxCommon)(Object.assign(Object.assign({}, gridbox), { position: Object.assign(Object.assign({}, gridbox.position), { x: (0,_src_hoiformat_schema__WEBPACK_IMPORTED_MODULE_6__.toNumberLike)(leftPadding) }) }), {
            size: { width: 0, height: 0 },
            orientation: 'upper_left'
        }, {
            styleTable,
            items: (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.arrayToMap)(traitGrixBoxItems, 'id'),
            onRenderItem: item => Promise.resolve(renderedTrait[item.id].replace('{{position}}', item.gridX + ', ' + item.gridY)),
            cornerPosition: 0.5,
        });
        miopreviewplaceholder.innerHTML = traitPreviewContent + styleTable.toStyleElement(window.styleNonce);
        (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.subscribeNavigators)();
    });
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
        warnings.value = mio.warnings.length === 0 ? (0,_util_i18n__WEBPACK_IMPORTED_MODULE_7__.feLocalize)('worldmap.warnings.nowarnings', 'No warnings.') :
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
window.addEventListener('load', (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.tryRun)(function () {
    return (0,tslib__WEBPACK_IMPORTED_MODULE_8__.__awaiter)(this, void 0, void 0, function* () {
        // Mio selection
        const mioSelect = document.getElementById('mios');
        if (mioSelect) {
            mioSelect.value = selectedMioIndex.toString();
            mioSelect.addEventListener('change', () => {
                selectedMioIndex = parseInt(mioSelect.value);
                (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.setState)({ selectedMioIndex });
                updateSelectedMio(true);
            });
        }
        // Conditions
        const conditionsElement = document.getElementById('conditions');
        if (conditionsElement) {
            conditions = new _util_dropdown__WEBPACK_IMPORTED_MODULE_1__.DivDropdown(conditionsElement, true);
            conditions.selectedValues$.next(selectedExprs.map(e => `${e.scopeName}!|${e.nodeContent}`));
            conditions.selectedValues$.subscribe((selection) => (0,tslib__WEBPACK_IMPORTED_MODULE_8__.__awaiter)(this, void 0, void 0, function* () {
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
            }));
        }
        // Zoom
        const contentElement = document.getElementById('miopreviewcontent');
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
        updateSelectedMio(false);
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
/******/ 			"miopreview": 0
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
/******/ 		var chunkLoadingGlobal = self["webpackChunkHearts_Of_Iron_IV_Utilities_2026"] = self["webpackChunkHearts_Of_Iron_IV_Utilities_2026"] || [];
/******/ 		chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
/******/ 		chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, chunkLoadingGlobal.push.bind(chunkLoadingGlobal));
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module depends on other loaded chunks and execution need to be delayed
/******/ 	var __webpack_exports__ = __webpack_require__.O(undefined, ["common"], () => (__webpack_require__("./webviewsrc/miopreview.ts")))
/******/ 	__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
/******/ 	
/******/ })()
;
//# sourceMappingURL=miopreview.js.map