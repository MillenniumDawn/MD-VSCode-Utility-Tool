/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./webviewsrc/guipreview.ts":
/*!**********************************!*\
  !*** ./webviewsrc/guipreview.ts ***!
  \**********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _src_util_styletable__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../src/util/styletable */ "./src/util/styletable.ts");
/* harmony import */ var _util_checkbox__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./util/checkbox */ "./webviewsrc/util/checkbox.ts");
/* harmony import */ var _util_common__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./util/common */ "./webviewsrc/util/common.ts");



const existingCheckboxes = [];
let toggleVisibilityContentVisible = (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.getState)().toggleVisibilityContentVisible;
function folderChange(folder) {
    const elements = document.getElementsByClassName('containerwindow');
    (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.setState)({ folder: folder });
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        element.style.display = element.id === folder ? 'block' : 'none';
    }
    setupContainerWindowToggles(folder);
}
function setupContainerWindowToggles(folder) {
    var _a, _b, _c, _d, _e, _f, _g;
    existingCheckboxes.forEach(checkbox => checkbox.dispose());
    existingCheckboxes.length = 0;
    const containerWindowVisibilities = (_a = (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.getState)().containerWindowVisibilities) !== null && _a !== void 0 ? _a : {};
    const toggleVisibilityContentInner = document.getElementById('toggleVisibilityContentInner');
    const containerWindowName = folder.replace('containerwindow_', '');
    toggleVisibilityContentInner.innerHTML = (_c = (_b = window.containerWindowToggles[containerWindowName]) === null || _b === void 0 ? void 0 : _b.content) !== null && _c !== void 0 ? _c : '';
    const checkboxes = document.getElementsByClassName('toggleContainerWindowCheckbox');
    const toggleVisibility = document.getElementById('toggleVisibility');
    toggleVisibility.disabled = toggleVisibilityContentInner.innerHTML === '';
    if (toggleVisibility.disabled) {
        toggleVisibilityContentVisible = false;
        refreshToggleVisibilityContent();
        (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.setState)({ toggleVisibilityContentVisible });
    }
    const relatedContainerWindow = {};
    for (let i = 0; i < checkboxes.length; i++) {
        const input = checkboxes.item(i);
        let selector = '.containerwindow_' + (0,_src_util_styletable__WEBPACK_IMPORTED_MODULE_0__.normalizeForStyle)(containerWindowName) + ' ';
        for (let j = 0; j <= i; j++) {
            const anotherInput = checkboxes.item(j);
            if (input.id.startsWith(anotherInput.id)) {
                selector = selector + '.childcontainerwindow_' + (0,_src_util_styletable__WEBPACK_IMPORTED_MODULE_0__.normalizeForStyle)((_e = (_d = anotherInput.attributes.getNamedItem('containerWindowName')) === null || _d === void 0 ? void 0 : _d.value) !== null && _e !== void 0 ? _e : '') + ' ';
            }
        }
        relatedContainerWindow[input.id] = document.querySelector(selector);
    }
    for (let i = 0; i < checkboxes.length; i++) {
        const input = checkboxes.item(i);
        input.checked = !(input.id in containerWindowVisibilities) || containerWindowVisibilities[input.id];
        const containerWindow = relatedContainerWindow[input.id];
        if (containerWindow) {
            containerWindow.style.display = input.checked ? 'block' : 'none';
        }
        const checkbox = new _util_checkbox__WEBPACK_IMPORTED_MODULE_1__.Checkbox(input, (_g = (_f = input.attributes.getNamedItem('containerWindowName')) === null || _f === void 0 ? void 0 : _f.value) !== null && _g !== void 0 ? _g : '');
        existingCheckboxes.push(checkbox);
        input.addEventListener('change', () => {
            containerWindowVisibilities[input.id] = input.checked;
            if (input.checked) {
                for (let i = 0; i < checkboxes.length; i++) {
                    const anotherInput = checkboxes.item(i);
                    if (anotherInput !== input && (anotherInput.id.startsWith(input.id) || input.id.startsWith(anotherInput.id))) {
                        anotherInput.checked = true;
                        containerWindowVisibilities[anotherInput.id] = true;
                    }
                }
            }
            else {
                for (let i = 0; i < checkboxes.length; i++) {
                    const anotherInput = checkboxes.item(i);
                    if (anotherInput !== input && anotherInput.id.startsWith(input.id)) {
                        anotherInput.checked = false;
                        containerWindowVisibilities[anotherInput.id] = false;
                    }
                }
            }
            (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.setState)({ containerWindowVisibilities });
            for (let i = 0; i < checkboxes.length; i++) {
                const input = checkboxes.item(i);
                const containerWindow = relatedContainerWindow[input.id];
                if (containerWindow) {
                    containerWindow.style.display = input.checked ? 'block' : 'none';
                }
            }
        });
    }
}
function refreshToggleVisibilityContent() {
    const mainContent = document.getElementById('mainContent');
    const toggleVisibilityContent = document.getElementById('toggleVisibilityContent');
    toggleVisibilityContent.style.display = toggleVisibilityContentVisible ? 'block' : 'none';
    mainContent.style.marginTop = toggleVisibilityContentVisible ? '240px' : '40px';
}
window.addEventListener('load', (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.tryRun)(function () {
    const folderSelector = document.getElementById('folderSelector');
    const folder = (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.getState)().folder || folderSelector.value;
    folderSelector.value = folder;
    folderChange(folder);
    folderSelector.addEventListener('change', function () {
        (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.setState)({ containerWindowVisibilities: {} });
        folderChange(this.value);
    });
    refreshToggleVisibilityContent();
    const toggleVisibility = document.getElementById('toggleVisibility');
    toggleVisibility.addEventListener('click', () => {
        toggleVisibilityContentVisible = !toggleVisibilityContentVisible;
        refreshToggleVisibilityContent();
        (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.setState)({ toggleVisibilityContentVisible });
    });
    (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.scrollToState)();
    (0,_util_common__WEBPACK_IMPORTED_MODULE_2__.subscribeRefreshButton)();
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
/******/ 			"guipreview": 0
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
/******/ 		var chunkLoadingGlobal = self["webpackChunkhearts_of_iron_4_utilities_2026"] = self["webpackChunkhearts_of_iron_4_utilities_2026"] || [];
/******/ 		chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
/******/ 		chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, chunkLoadingGlobal.push.bind(chunkLoadingGlobal));
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module depends on other loaded chunks and execution need to be delayed
/******/ 	var __webpack_exports__ = __webpack_require__.O(undefined, ["common"], () => (__webpack_require__("./webviewsrc/guipreview.ts")))
/******/ 	__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
/******/ 	
/******/ })()
;
//# sourceMappingURL=guipreview.js.map