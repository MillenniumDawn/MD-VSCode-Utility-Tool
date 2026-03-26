"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TopBar = exports.topBarHeight = void 0;
const event_1 = require("../util/event");
const viewpoint_1 = require("./viewpoint");
const vscode_1 = require("../util/vscode");
const i18n_1 = require("../util/i18n");
const dropdown_1 = require("../util/dropdown");
const rxjs_1 = require("rxjs");
const renderer_1 = require("./renderer");
const telemetry_1 = require("../util/telemetry");
exports.topBarHeight = 40;
class TopBar extends event_1.Subscriber {
    constructor(canvas, viewPoint, loader, state) {
        var _a, _b, _c, _d, _e, _f;
        super();
        this.viewPoint = viewPoint;
        this.loader = loader;
        this.warningsVisible = false;
        this.addSubscription(this.warningFilter = new dropdown_1.DivDropdown(document.getElementById('warningfilter'), true));
        this.addSubscription(this.display = new dropdown_1.DivDropdown(document.getElementById('display'), true));
        this.viewMode$ = (0, event_1.toBehaviorSubject)(document.getElementById('viewmode'), (_a = state.viewMode) !== null && _a !== void 0 ? _a : 'province');
        this.colorSet$ = (0, event_1.toBehaviorSubject)(document.getElementById('colorset'), (_b = state.colorSet) !== null && _b !== void 0 ? _b : 'provinceid');
        this.hoverProvinceId$ = new rxjs_1.BehaviorSubject(undefined);
        this.selectedProvinceId$ = new rxjs_1.BehaviorSubject((_c = state.selectedProvinceId) !== null && _c !== void 0 ? _c : undefined);
        this.hoverStateId$ = new rxjs_1.BehaviorSubject(undefined);
        this.selectedStateId$ = new rxjs_1.BehaviorSubject((_d = state.selectedStateId) !== null && _d !== void 0 ? _d : undefined);
        this.hoverStrategicRegionId$ = new rxjs_1.BehaviorSubject(undefined);
        this.selectedStrategicRegionId$ = new rxjs_1.BehaviorSubject((_e = state.selectedStrategicRegionId) !== null && _e !== void 0 ? _e : undefined);
        this.hoverSupplyAreaId$ = new rxjs_1.BehaviorSubject(undefined);
        this.selectedSupplyAreaId$ = new rxjs_1.BehaviorSubject((_f = state.selectedSupplyAreaId) !== null && _f !== void 0 ? _f : undefined);
        if (state.warningFilter) {
            this.warningFilter.selectedValues$.next(state.warningFilter);
        }
        else {
            this.warningFilter.selectAll();
        }
        if (state.display) {
            this.display.selectedValues$.next(state.display);
        }
        else {
            this.display.selectAll();
        }
        this.searchBox = document.getElementById("searchbox");
        this.loadControls();
        this.registerEventListeners(canvas);
    }
    onViewModeChange() {
        var _a;
        document.querySelectorAll('#colorset > option[viewmode]').forEach(v => {
            v.hidden = true;
        });
        let colorSetHidden = true;
        document.querySelectorAll('#colorset > option[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            v.hidden = false;
            if (v.value === this.colorSet$.value) {
                colorSetHidden = false;
            }
        });
        document.querySelectorAll('#colorset > option:not([viewmode])').forEach(v => {
            if (v.value === this.colorSet$.value) {
                colorSetHidden = false;
            }
        });
        document.querySelectorAll('button[viewmode]').forEach(v => {
            v.style.display = 'none';
        });
        document.querySelectorAll('button[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            v.style.display = 'inline-block';
        });
        document.querySelectorAll('.group[viewmode]').forEach(v => {
            v.style.display = 'none';
        });
        document.querySelectorAll('.group[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            v.style.display = 'inline-block';
        });
        if (colorSetHidden) {
            const newColorset = (_a = document.querySelector('#colorset > option:not(*[hidden])')) === null || _a === void 0 ? void 0 : _a.value;
            this.colorSet$.next(newColorset);
        }
        this.setSearchBoxPlaceHolder();
    }
    loadControls() {
        this.loadWarningButton();
        this.loadSearchBox();
        this.loadRefreshButton();
        this.loadOpenButton();
        this.loadExportButton();
    }
    loadWarningButton() {
        const warningsContainer = document.getElementById('warnings-container');
        const showWarnings = document.getElementById('show-warnings');
        this.addSubscription((0, rxjs_1.fromEvent)(showWarnings, 'click').subscribe(() => {
            this.warningsVisible = !this.warningsVisible;
            if (this.warningsVisible) {
                (0, telemetry_1.sendEvent)('worldmap.openwarnings');
                warningsContainer.style.display = 'block';
            }
            else {
                warningsContainer.style.display = 'none';
            }
        }));
    }
    loadSearchBox() {
        const searchBox = this.searchBox;
        const search = document.getElementById("search");
        this.addSubscription((0, rxjs_1.fromEvent)(searchBox, 'keypress').subscribe((e) => {
            if (e.code === 'Enter') {
                (0, telemetry_1.sendEvent)('worldmap.search', { keypress: 'true' });
                this.search(searchBox.value);
            }
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(search, 'click').subscribe(() => {
            (0, telemetry_1.sendEvent)('worldmap.search', { keypress: 'false' });
            this.search(searchBox.value);
        }));
    }
    loadRefreshButton() {
        const refresh = document.getElementById("refresh");
        this.addSubscription((0, rxjs_1.fromEvent)(refresh, 'click').subscribe(() => {
            if (!refresh.disabled) {
                (0, telemetry_1.sendEvent)('worldmap.refresh');
                this.loader.refresh();
            }
        }));
        this.addSubscription(this.loader.loading$.subscribe(v => {
            refresh.disabled = v;
        }));
    }
    openMapItem(useHoverValue = false) {
        var _a, _b, _c, _d, _e, _f;
        (0, telemetry_1.sendEvent)('worldmap.open.' + this.viewMode$.value + (useHoverValue ? '.dblclick' : ''));
        if (this.viewMode$.value === 'state') {
            const selected = useHoverValue ? this.hoverStateId$.value : this.selectedStateId$.value;
            if (selected) {
                const state = this.loader.worldMap.getStateById(selected);
                if (state) {
                    vscode_1.vscode.postMessage({ command: 'openfile', type: 'state', file: state.file, start: (_a = state.token) === null || _a === void 0 ? void 0 : _a.start, end: (_b = state.token) === null || _b === void 0 ? void 0 : _b.end });
                }
            }
        }
        else if (this.viewMode$.value === 'strategicregion') {
            const selected = useHoverValue ? this.hoverStrategicRegionId$.value : this.selectedStrategicRegionId$.value;
            if (selected) {
                const strategicRegion = this.loader.worldMap.getStrategicRegionById(selected);
                if (strategicRegion) {
                    vscode_1.vscode.postMessage({ command: 'openfile', type: 'strategicregion', file: strategicRegion.file,
                        start: (_c = strategicRegion.token) === null || _c === void 0 ? void 0 : _c.start, end: (_d = strategicRegion.token) === null || _d === void 0 ? void 0 : _d.end });
                }
            }
        }
        else if (this.viewMode$.value === 'supplyarea') {
            const selected = useHoverValue ? this.hoverSupplyAreaId$.value : this.selectedSupplyAreaId$.value;
            if (selected) {
                const supplyArea = this.loader.worldMap.getSupplyAreaById(selected);
                if (supplyArea) {
                    vscode_1.vscode.postMessage({ command: 'openfile', type: 'supplyarea', file: supplyArea.file,
                        start: (_e = supplyArea.token) === null || _e === void 0 ? void 0 : _e.start, end: (_f = supplyArea.token) === null || _f === void 0 ? void 0 : _f.end });
                }
            }
        }
    }
    loadOpenButton() {
        const open = document.getElementById("open");
        this.addSubscription((0, rxjs_1.fromEvent)(open, 'click').subscribe((e) => {
            e.stopPropagation();
            this.openMapItem();
        }));
        this.addSubscription((0, rxjs_1.combineLatest)([this.viewMode$, this.selectedStateId$, this.selectedStrategicRegionId$, this.selectedSupplyAreaId$]).subscribe(([viewMode, selectedStateId, selectedStrategicRegionId, selectedSupplyAreaId]) => {
            open.disabled = !((viewMode === 'state' && selectedStateId !== undefined) ||
                (viewMode === 'strategicregion' && selectedStrategicRegionId !== undefined) ||
                (viewMode === 'supplyarea' && selectedSupplyAreaId !== undefined));
        }));
    }
    loadExportButton() {
        const exportButton = document.getElementById("export");
        exportButton.disabled = true;
        this.addSubscription(this.loader.worldMap$.subscribe(wm => {
            exportButton.disabled = !wm;
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(exportButton, 'click').subscribe(e => {
            e.stopPropagation();
            vscode_1.vscode.postMessage({ command: 'requestexportmap' });
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(window, 'message').subscribe(event => {
            const message = event.data;
            if (message.command !== 'requestexportmap') {
                return;
            }
            const worldMap = this.loader.worldMap;
            if (!worldMap) {
                return;
            }
            (0, telemetry_1.sendEvent)('worldmap.export');
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, worldMap.width);
            canvas.height = Math.max(1, worldMap.height);
            const viewPoint = new viewpoint_1.ViewPoint(canvas, this.loader, 0, { x: 0, y: 0, scale: 1 });
            renderer_1.Renderer.renderMapImpl(canvas, this, viewPoint, worldMap, { preciseEdge: true, overwriteRenderPrecision: 1 });
            vscode_1.vscode.postMessage({ command: 'exportmap', dataUrl: canvas.toDataURL() });
        }));
    }
    registerEventListeners(canvas) {
        this.addSubscription((0, rxjs_1.fromEvent)(canvas, 'mousemove').subscribe((e) => {
            var _a, _b, _c, _d;
            if (!this.loader.worldMap) {
                this.hoverProvinceId$.next(undefined);
                this.hoverStateId$.next(undefined);
                this.hoverStrategicRegionId$.next(undefined);
                this.hoverSupplyAreaId$.next(undefined);
                return;
            }
            const worldMap = this.loader.worldMap;
            let x = this.viewPoint.convertBackX(e.pageX);
            let y = this.viewPoint.convertBackY(e.pageY);
            if (x < 0) {
                x += worldMap.width;
            }
            while (x >= worldMap.width && worldMap.width > 0) {
                x -= worldMap.width;
            }
            this.hoverProvinceId$.next((_a = worldMap.getProvinceByPosition(x, y)) === null || _a === void 0 ? void 0 : _a.id);
            this.hoverStateId$.next(this.hoverProvinceId$.value === undefined ? undefined : (_b = worldMap.getStateByProvinceId(this.hoverProvinceId$.value)) === null || _b === void 0 ? void 0 : _b.id);
            this.hoverStrategicRegionId$.next(this.hoverProvinceId$.value === undefined ? undefined : (_c = worldMap.getStrategicRegionByProvinceId(this.hoverProvinceId$.value)) === null || _c === void 0 ? void 0 : _c.id);
            this.hoverSupplyAreaId$.next(this.hoverStateId$.value === undefined ? undefined : (_d = worldMap.getSupplyAreaByStateId(this.hoverStateId$.value)) === null || _d === void 0 ? void 0 : _d.id);
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(canvas, 'mouseleave').subscribe(() => {
            this.hoverProvinceId$.next(undefined);
            this.hoverStateId$.next(undefined);
            this.hoverStrategicRegionId$.next(undefined);
            this.hoverSupplyAreaId$.next(undefined);
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(canvas, 'click').subscribe(() => {
            switch (this.viewMode$.value) {
                case 'province':
                    this.selectedProvinceId$.next(this.selectedProvinceId$.value === this.hoverProvinceId$.value ? undefined : this.hoverProvinceId$.value);
                    break;
                case 'state':
                    this.selectedStateId$.next(this.selectedStateId$.value === this.hoverStateId$.value ? undefined : this.hoverStateId$.value);
                    break;
                case 'strategicregion':
                    this.selectedStrategicRegionId$.next(this.selectedStrategicRegionId$.value === this.hoverStrategicRegionId$.value ? undefined : this.hoverStrategicRegionId$.value);
                    break;
                case 'supplyarea':
                    this.selectedSupplyAreaId$.next(this.selectedSupplyAreaId$.value === this.hoverSupplyAreaId$.value ? undefined : this.hoverSupplyAreaId$.value);
                    break;
            }
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(canvas, 'dblclick').subscribe(e => {
            e.stopPropagation();
            this.openMapItem(true);
        }));
        this.addSubscription(this.viewMode$.subscribe(() => this.onViewModeChange()));
        this.addSubscription(this.loader.worldMap$.subscribe(wm => {
            const warnings = document.getElementById('warnings');
            if (wm.warnings.length === 0) {
                warnings.value = (0, i18n_1.feLocalize)('worldmap.warnings.nowarnings', 'No warnings.');
            }
            else {
                warnings.value = (0, i18n_1.feLocalize)('worldmap.warnings', 'World map warnings: \n\n{0}', wm.warnings.map(warningToString).join('\n'));
            }
            this.setSearchBoxPlaceHolder(wm);
        }));
    }
    search(text) {
        const number = parseInt(text);
        if (isNaN(number)) {
            return;
        }
        const viewMode = this.viewMode$.value;
        const [getRegionById, selectedId] = viewMode === 'province' ? [this.loader.worldMap.getProvinceById, this.selectedProvinceId$] :
            viewMode === 'state' ? [this.loader.worldMap.getStateById, this.selectedStateId$] :
                viewMode === 'strategicregion' ? [this.loader.worldMap.getStrategicRegionById, this.selectedStrategicRegionId$] :
                    viewMode === 'supplyarea' ? [this.loader.worldMap.getSupplyAreaById, this.selectedSupplyAreaId$] :
                        [() => undefined, undefined];
        const region = getRegionById(number);
        if (region) {
            selectedId === null || selectedId === void 0 ? void 0 : selectedId.next(number);
            this.viewPoint.centerZone(region.boundingBox);
        }
    }
    setSearchBoxPlaceHolder(worldMap) {
        if (!worldMap) {
            worldMap = this.loader.worldMap;
        }
        let placeholder = '';
        switch (this.viewMode$.value) {
            case 'province':
                placeholder = worldMap.provincesCount > 1 ? `1-${worldMap.provincesCount - 1}` : '';
                break;
            case 'state':
                placeholder = worldMap.statesCount > 1 ? `1-${worldMap.statesCount - 1}` : '';
                break;
            case 'strategicregion':
                placeholder = worldMap.strategicRegionsCount > 1 ? `1-${worldMap.strategicRegionsCount - 1}` : '';
                break;
            case 'supplyarea':
                placeholder = worldMap.supplyAreasCount > 1 ? `1-${worldMap.supplyAreasCount - 1}` : '';
                break;
            default:
                break;
        }
        if (placeholder) {
            this.searchBox.placeholder = (0, i18n_1.feLocalize)('worldmap.topbar.search.placeholder', 'Range: {0}', placeholder);
        }
        else {
            this.searchBox.placeholder = '';
        }
    }
}
exports.TopBar = TopBar;
function warningToString(warning) {
    return `[${warning.source.map(s => `${s.type[0].toUpperCase()}${s.type.substr(1)} ${'id' in s ? s.id : s.name}`).join(', ')}] ${warning.text}`;
}
//# sourceMappingURL=topbar.js.map