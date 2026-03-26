"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const loader_1 = require("./loader");
const viewpoint_1 = require("./viewpoint");
const topbar_1 = require("./topbar");
const common_1 = require("../util/common");
const renderer_1 = require("./renderer");
const rxjs_1 = require("rxjs");
(0, rxjs_1.fromEvent)(window, 'load').subscribe(function () {
    hideBySupplyAreaFlag(window['__enableSupplyArea']);
    const state = (0, common_1.getState)();
    const loader = new loader_1.Loader();
    const mainCanvas = document.getElementById('main-canvas');
    const viewPoint = new viewpoint_1.ViewPoint(mainCanvas, loader, topbar_1.topBarHeight, state.viewPoint || { x: 0, y: -topbar_1.topBarHeight, scale: 1 });
    const topBar = new topbar_1.TopBar(mainCanvas, viewPoint, loader, state);
    const renderer = new renderer_1.Renderer(mainCanvas, viewPoint, loader, topBar);
    (0, rxjs_1.fromEvent)(mainCanvas, 'contextmenu').subscribe(event => event.preventDefault());
    viewPoint.observable$.subscribe(setStateForKey('viewPoint'));
    topBar.viewMode$.subscribe(setStateForKey('viewMode'));
    topBar.colorSet$.subscribe(setStateForKey('colorSet'));
    topBar.selectedProvinceId$.subscribe(setStateForKey('selectedProvinceId'));
    topBar.selectedStateId$.subscribe(setStateForKey('selectedStateId'));
    topBar.selectedStrategicRegionId$.subscribe(setStateForKey('selectedStrategicRegionId'));
    topBar.selectedSupplyAreaId$.subscribe(setStateForKey('selectedSupplyAreaId'));
    topBar.warningFilter.selectedValues$.subscribe(setStateForKey('warningFilter'));
    topBar.display.selectedValues$.subscribe(setStateForKey('display'));
});
function setStateForKey(key) {
    return newValue => {
        (0, common_1.setState)({ [key]: newValue });
    };
}
function hideBySupplyAreaFlag(enableSupplyArea) {
    const viewModes = document.getElementById('viewmode').getElementsByTagName('option');
    for (let i = 0; i < viewModes.length; i++) {
        const viewMode = viewModes[i];
        const attribute = viewMode.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            viewMode.remove();
        }
    }
    const colorSets = document.getElementById('colorset').getElementsByTagName('option');
    for (let i = 0; i < colorSets.length; i++) {
        const colorSet = colorSets[i];
        const attribute = colorSet.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            colorSet.remove();
        }
    }
    const displayOptions = document.getElementById('display').getElementsByTagName('div');
    for (let i = 0; i < displayOptions.length; i++) {
        const displayOption = displayOptions[i];
        const attribute = displayOption.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            displayOption.remove();
        }
    }
    const warningFilterOptions = document.getElementById('warningfilter').getElementsByTagName('div');
    for (let i = 0; i < warningFilterOptions.length; i++) {
        const warningFilterOption = warningFilterOptions[i];
        const attribute = warningFilterOption.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            warningFilterOption.remove();
        }
    }
}
//# sourceMappingURL=index.js.map