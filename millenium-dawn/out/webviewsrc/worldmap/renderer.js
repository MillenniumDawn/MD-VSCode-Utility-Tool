"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Renderer = void 0;
const graphutils_1 = require("./graphutils");
const topbar_1 = require("./topbar");
const event_1 = require("../util/event");
const common_1 = require("../util/common");
const i18n_1 = require("../util/i18n");
const lodash_1 = require("lodash");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const landWarning = 0xE02020;
const landNoWarning = 0x7FFF7F;
const waterWarning = 0xC00000;
const waterNoWarning = 0x20E020;
const renderScaleByViewMode = {
    province: { edge: 2, labels: 3 },
    state: { edge: 1, labels: 1 },
    strategicregion: { edge: 0.25, labels: 0.25 },
    supplyarea: { edge: 0.5, labels: 1 },
    warnings: { edge: 2, labels: 3 },
};
class Renderer extends event_1.Subscriber {
    constructor(mainCanvas, viewPoint, loader, topBar) {
        super();
        this.mainCanvas = mainCanvas;
        this.viewPoint = viewPoint;
        this.loader = loader;
        this.topBar = topBar;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.cursorX = 0;
        this.cursorY = 0;
        this.reloadImages = () => {
            for (const resource of this.loader.worldMap.resources) {
                const image = new Image();
                image.onload = () => {
                    Renderer.resourceImages[resource.name] = image;
                };
                image.src = resource.imageUri;
            }
        };
        this.renderCanvas = () => {
            if (this.canvasWidth <= 0 && this.canvasHeight <= 0) {
                return;
            }
            const backCanvasContext = this.backCanvasContext;
            backCanvasContext.fillStyle = 'black';
            backCanvasContext.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
            backCanvasContext.fillStyle = 'white';
            backCanvasContext.font = '12px sans-serif';
            this.renderMap();
            backCanvasContext.drawImage(this.mapCanvas, 0, 0);
            const viewMode = this.topBar.viewMode$.value;
            switch (viewMode) {
                case 'province':
                case 'warnings':
                    this.renderProvinceHoverSelection(this.loader.worldMap);
                    break;
                case 'state':
                    this.renderStateHoverSelection(this.loader.worldMap);
                    break;
                case 'strategicregion':
                    this.renderStrategicRegionHoverSelection(this.loader.worldMap);
                    break;
                case 'supplyarea':
                    this.renderSupplyAreaHoverSelection(this.loader.worldMap);
                    break;
            }
            if (this.loader.progressText !== '') {
                this.renderLoadingText(this.loader.progressText);
            }
            else if (this.loader.loading$.value) {
                this.renderLoadingText((0, i18n_1.feLocalize)('worldmap.progress.visualizing', 'Visualizing map data: {0}', Math.round(this.loader.progress * 100) + '%'));
            }
            this.mainCanvasContext.drawImage(this.backCanvas, 0, 0);
        };
        this.resizeCanvas = () => {
            this.canvasWidth = this.mainCanvas.width = this.mapCanvas.width = this.backCanvas.width = window.innerWidth;
            this.canvasHeight = this.mainCanvas.height = this.mapCanvas.height = this.backCanvas.height = window.innerHeight;
            this.renderCanvas();
        };
        this.oldMapState = undefined;
        this.addSubscription((0, rxjs_1.fromEvent)(window, 'resize').subscribe(this.resizeCanvas));
        this.mainCanvasContext = this.mainCanvas.getContext('2d');
        this.backCanvas = document.createElement('canvas');
        this.backCanvasContext = this.backCanvas.getContext('2d');
        this.mapCanvas = document.createElement('canvas');
        this.registerCanvasEventHandlers();
        this.resizeCanvas();
        this.addSubscription(loader.worldMap$.subscribe(this.reloadImages));
        this.addSubscription(loader.worldMap$.subscribe(this.renderCanvas));
        this.addSubscription((0, rxjs_1.combineLatest)([
            loader.progress$,
            viewPoint.observable$,
            topBar.viewMode$,
            topBar.colorSet$,
            topBar.hoverProvinceId$,
            topBar.selectedProvinceId$,
            topBar.hoverStateId$,
            topBar.selectedStateId$,
            topBar.hoverStrategicRegionId$,
            topBar.selectedStrategicRegionId$,
            topBar.hoverSupplyAreaId$,
            topBar.selectedSupplyAreaId$,
            topBar.warningFilter.selectedValues$,
            topBar.display.selectedValues$,
        ]).pipe((0, operators_1.distinctUntilChanged)((x, y) => x.every((v, i) => v === y[i]))).subscribe(this.renderCanvas));
    }
    renderMap() {
        const worldMap = this.loader.worldMap;
        const displayOptions = this.topBar.display.selectedValues$.value;
        const newMapState = Object.assign({ worldMap, canvasWidth: this.canvasWidth, canvasHeight: this.canvasHeight, viewMode: this.topBar.viewMode$.value, colorSet: this.topBar.colorSet$.value, warningFilter: this.topBar.warningFilter.selectedValues$.value, edgeVisible: displayOptions.includes('edge'), labelVisible: displayOptions.includes('label'), adaptZooming: displayOptions.includes('adaptzooming'), fastRendering: displayOptions.includes('fastrending'), supplyVisible: displayOptions.includes('supply'), riverVisible: displayOptions.includes('river') }, this.viewPoint.toJson());
        // State not changed
        if (this.oldMapState !== undefined && Object.keys(newMapState).every(k => this.oldMapState[k] === newMapState[k])) {
            return;
        }
        this.oldMapState = newMapState;
        Renderer.renderMapImpl(this.mapCanvas, this.topBar, this.viewPoint, worldMap, newMapState.fastRendering ? {} : { preciseEdge: true, overwriteRenderPrecision: 1 });
    }
    static renderMapImpl(canvas, topBar, viewPoint, worldMap, otherRenderContext) {
        const mapCanvasContext = canvas.getContext('2d');
        mapCanvasContext.fillStyle = 'black';
        mapCanvasContext.fillRect(0, 0, canvas.width, canvas.height);
        const renderContext = Object.assign({ topBar,
            viewPoint,
            mapCanvasContext, provinceToState: worldMap.getProvinceToStateMap(), provinceToStrategicRegion: worldMap.getProvinceToStrategicRegionMap(), stateToSupplyArea: worldMap.getStateToSupplyAreaMap(), renderedProvincesByOffset: {}, renderedProvincesById: {}, extraState: undefined }, otherRenderContext);
        const mapZone = { x: 0, y: 0, w: worldMap.width, h: worldMap.height };
        Renderer.renderAllOffsets(viewPoint, mapZone, worldMap.width, xOffset => Renderer.renderMapBackground(worldMap, xOffset, renderContext));
        renderContext.renderedProvinces = Object.values(renderContext.renderedProvincesById);
        Renderer.renderAllOffsets(viewPoint, mapZone, worldMap.width, xOffset => Renderer.renderMapForeground(worldMap, xOffset, renderContext));
    }
    static renderMapBackground(worldMap, xOffset, renderContext) {
        var _a;
        const { mapCanvasContext: context, topBar, viewPoint, overwriteRenderPrecision } = renderContext;
        const scale = viewPoint.scale;
        const renderedProvinces = (_a = renderContext.renderedProvincesByOffset[xOffset]) !== null && _a !== void 0 ? _a : [];
        const { renderedProvincesById } = renderContext;
        renderContext.renderedProvincesByOffset[xOffset] = renderedProvinces;
        const edgeVisible = Renderer.isEdgeVisible(topBar, viewPoint);
        worldMap.forEachProvince(province => {
            if (renderContext.viewPoint.bboxInView(province.boundingBox, xOffset)) {
                const color = getColorByColorSet(topBar.colorSet$.value, province, worldMap, renderContext);
                context.fillStyle = toColor(color);
                Renderer.renderProvince(viewPoint, context, province, scale, xOffset, overwriteRenderPrecision);
                renderedProvinces.push(province);
                renderedProvincesById[province.id] = province;
            }
            if (edgeVisible) {
                for (const edge of province.edges) {
                    if (edge.path.length > 0) {
                        continue;
                    }
                    const toProvince = worldMap.getProvinceById(edge.to);
                    if (!toProvince) {
                        continue;
                    }
                    const [startPoint, endPoint] = findNearestPoints(edge.start, edge.stop, province, toProvince);
                    if (renderContext.viewPoint.lineInView(startPoint, endPoint, xOffset)) {
                        if (!(province.id in renderedProvincesById)) {
                            renderedProvinces.push(province);
                            renderedProvincesById[province.id] = province;
                        }
                        if (!(edge.to in renderedProvincesById)) {
                            renderedProvinces.push(toProvince);
                            renderedProvincesById[edge.to] = toProvince;
                        }
                    }
                }
            }
        });
    }
    static renderMapForeground(worldMap, xOffset, renderContext) {
        const { mapCanvasContext: context, topBar, viewPoint } = renderContext;
        if (Renderer.isRiverVisible(topBar, viewPoint)) {
            Renderer.renderRivers(renderContext, worldMap, context, xOffset);
        }
        if (Renderer.isEdgeVisible(topBar, viewPoint)) {
            Renderer.renderAllEdges(renderContext, worldMap, context, xOffset);
        }
        if (Renderer.isSupplyVisible(topBar)) {
            Renderer.renderSupplyRelated(renderContext, worldMap, context, xOffset);
        }
        if (Renderer.isLabelVisible(topBar, viewPoint)) {
            Renderer.renderMapLabels(renderContext, worldMap, context, xOffset);
        }
    }
    static isEdgeVisible(topBar, viewPoint) {
        if (topBar.display.selectedValues$.value.includes('adaptzooming')) {
            const viewMode = topBar.viewMode$.value;
            const renderScale = renderScaleByViewMode[viewMode];
            const scale = viewPoint.scale;
            return renderScale.edge <= scale && topBar.display.selectedValues$.value.includes('edge');
        }
        return topBar.display.selectedValues$.value.includes('edge');
    }
    static isLabelVisible(topBar, viewPoint) {
        if (topBar.display.selectedValues$.value.includes('adaptzooming')) {
            const viewMode = topBar.viewMode$.value;
            const renderScale = renderScaleByViewMode[viewMode];
            const scale = viewPoint.scale;
            return renderScale.labels <= scale && topBar.display.selectedValues$.value.includes('label');
        }
        return topBar.display.selectedValues$.value.includes('label');
    }
    isMouseHighlightVisible() {
        return this.topBar.display.selectedValues$.value.includes('mousehighlight');
    }
    isTooltipVisible() {
        return this.topBar.display.selectedValues$.value.includes('tooltip');
    }
    static isSupplyVisible(topBar) {
        return topBar.display.selectedValues$.value.includes('supply');
    }
    static isRiverVisible(topBar, viewPoint) {
        if (topBar.display.selectedValues$.value.includes('adaptzooming')) {
            return 1 <= viewPoint.scale && topBar.display.selectedValues$.value.includes('river');
        }
        return topBar.display.selectedValues$.value.includes('river');
    }
    static renderAllEdges(renderContext, worldMap, context, xOffset) {
        var _a;
        const renderedProvinces = (_a = renderContext.renderedProvincesByOffset[xOffset]) !== null && _a !== void 0 ? _a : [];
        const preciseEdge = renderContext.preciseEdge;
        context.strokeStyle = 'black';
        context.beginPath();
        for (const province of renderedProvinces) {
            Renderer.renderEdges(renderContext, province, worldMap, context, xOffset, false, preciseEdge);
        }
        context.stroke();
        context.strokeStyle = 'red';
        context.beginPath();
        for (const province of renderedProvinces) {
            Renderer.renderEdges(renderContext, province, worldMap, context, xOffset, true, preciseEdge);
        }
        context.stroke();
    }
    static renderMapLabels(renderContext, worldMap, context, xOffset) {
        var _a;
        const { provinceToState, provinceToStrategicRegion, stateToSupplyArea, topBar, viewPoint } = renderContext;
        const renderedProvinces = (_a = renderContext.renderedProvincesByOffset[xOffset]) !== null && _a !== void 0 ? _a : [];
        const viewMode = topBar.viewMode$.value;
        const colorSet = topBar.colorSet$.value;
        const showSupply = Renderer.isSupplyVisible(topBar);
        context.font = '10px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        if (viewMode === 'province' || viewMode === 'warnings') {
            for (const province of renderedProvinces) {
                const provinceColor = showSupply && worldMap.getSupplyNodeByProvinceId(province.id) ? 0xFF0000 :
                    getColorByColorSet(colorSet, province, worldMap, renderContext);
                context.fillStyle = toColor(getHighConstrastColor(provinceColor));
                const labelPosition = province.centerOfMass;
                context.fillText(province.id.toString(), viewPoint.convertX(labelPosition.x + xOffset), viewPoint.convertY(labelPosition.y));
            }
        }
        else {
            const renderedRegions = {};
            const regionMap = viewMode === 'state' ? provinceToState : provinceToStrategicRegion;
            const getRegionById = viewMode === 'state' ? worldMap.getStateById : viewMode === 'supplyarea' ? worldMap.getSupplyAreaById : worldMap.getStrategicRegionById;
            for (const province of renderedProvinces) {
                const stateId = viewMode === 'supplyarea' ? provinceToState[province.id] : undefined;
                const regionId = viewMode === 'supplyarea' ? (stateId !== undefined ? stateToSupplyArea[stateId] : undefined) : regionMap[province.id];
                if (regionId !== undefined && !renderedRegions[regionId]) {
                    renderedRegions[regionId] = true;
                    const region = getRegionById(regionId);
                    if (region) {
                        const labelPosition = region.centerOfMass;
                        const provinceAtLabel = worldMap.getProvinceByPosition(labelPosition.x, labelPosition.y);
                        const provinceColor = getColorByColorSet(colorSet, provinceAtLabel !== null && provinceAtLabel !== void 0 ? provinceAtLabel : province, worldMap, renderContext);
                        context.fillStyle = toColor(getHighConstrastColor(provinceColor));
                        context.fillText(region.id.toString(), viewPoint.convertX(labelPosition.x + xOffset), viewPoint.convertY(labelPosition.y));
                        if (viewMode === 'state' && colorSet === 'resources') {
                            const { width } = Renderer.getResourcesSize(region, 0.7, 16);
                            Renderer.renderResources(context, region, viewPoint.convertX(labelPosition.x + xOffset) - width / 2, viewPoint.convertY(labelPosition.y) + 5, 0.7, 16);
                        }
                    }
                }
            }
        }
    }
    static renderEdges(renderContext, province, worldMap, context, xOffset, isRed, preciseEdge) {
        var _a, _b, _c, _d;
        const { provinceToState, provinceToStrategicRegion, stateToSupplyArea, renderedProvinces, topBar, viewPoint } = renderContext;
        const scale = viewPoint.scale;
        const viewMode = topBar.viewMode$.value;
        context.lineWidth = 2;
        for (const provinceEdge of province.edges) {
            if (!('path' in provinceEdge)) {
                continue;
            }
            if (provinceEdge.to > province.id) {
                continue;
            }
            const stateFromId = provinceToState[province.id];
            const stateToId = provinceToState[provinceEdge.to];
            const stateFromImpassable = (_b = (_a = worldMap.getStateById(stateFromId)) === null || _a === void 0 ? void 0 : _a.impassable) !== null && _b !== void 0 ? _b : false;
            const stateToImpassable = (_d = (_c = worldMap.getStateById(stateToId)) === null || _c === void 0 ? void 0 : _c.impassable) !== null && _d !== void 0 ? _d : false;
            const impassable = provinceEdge.type === 'impassable' || stateFromImpassable !== stateToImpassable;
            const paths = provinceEdge.path;
            if ((impassable || (paths.length === 0 && provinceEdge.type !== 'impassable')) !== isRed) {
                continue;
            }
            const strategicRegionFromId = provinceToStrategicRegion[province.id];
            const strategicRegionToId = provinceToStrategicRegion[provinceEdge.to];
            if (!impassable && paths.length > 0) {
                if (viewMode === 'state') {
                    if (stateFromId === stateToId && (stateFromId !== undefined || strategicRegionFromId === strategicRegionToId)) {
                        continue;
                    }
                }
                else if (viewMode === 'strategicregion') {
                    if (strategicRegionFromId === strategicRegionToId) {
                        continue;
                    }
                }
                else if (viewMode === 'supplyarea') {
                    if ((stateFromId === stateToId && (stateFromId !== undefined || strategicRegionFromId === strategicRegionToId)) ||
                        (stateFromId !== undefined && stateToId !== undefined && stateToSupplyArea[stateFromId] === stateToSupplyArea[stateToId])) {
                        continue;
                    }
                }
            }
            for (const path of paths) {
                if (path.length === 0) {
                    continue;
                }
                context.moveTo(viewPoint.convertX(path[0].x + xOffset), viewPoint.convertY(path[0].y));
                for (let j = 0; j < path.length; j++) {
                    if (!preciseEdge && scale <= 4 && j % (scale < 1 ? Math.floor(10 / scale) : 6 - scale) !== 0 && !isCriticalPoint(path, j)) {
                        continue;
                    }
                    const pos = path[j];
                    context.lineTo(viewPoint.convertX(pos.x + xOffset), viewPoint.convertY(pos.y));
                }
            }
            if (paths.length === 0 && provinceEdge.type !== 'impassable') {
                const toProvince = renderedProvinces === null || renderedProvinces === void 0 ? void 0 : renderedProvinces.find(p => p.id === provinceEdge.to);
                const [startPoint, endPoint] = findNearestPoints(provinceEdge.start, provinceEdge.stop, province, toProvince);
                context.moveTo(viewPoint.convertX(startPoint.x + xOffset), viewPoint.convertY(startPoint.y));
                context.lineTo(viewPoint.convertX(endPoint.x + xOffset), viewPoint.convertY(endPoint.y));
            }
        }
    }
    static renderSupplyRelated(renderContext, worldMap, context, xOffset) {
        const { renderedProvincesById, viewPoint } = renderContext;
        context.strokeStyle = 'rgb(200, 0, 0)';
        worldMap.forEachRailway(railway => {
            if (railway.provinces.every(id => !renderedProvincesById[id])) {
                return;
            }
            context.beginPath();
            context.lineWidth = Math.min(10, 2 * railway.level);
            let hasProvince = false;
            for (let i = 0; i < railway.provinces.length; i++) {
                const province = worldMap.getProvinceById(railway.provinces[i]);
                if (province) {
                    if (!hasProvince) {
                        context.moveTo(viewPoint.convertX(province.centerOfMass.x + xOffset), viewPoint.convertY(province.centerOfMass.y));
                    }
                    else {
                        context.lineTo(viewPoint.convertX(province.centerOfMass.x + xOffset), viewPoint.convertY(province.centerOfMass.y));
                    }
                    hasProvince = true;
                }
                else {
                    context.stroke();
                    hasProvince = false;
                }
            }
            if (hasProvince) {
                context.stroke();
            }
        });
        context.fillStyle = 'rgb(200, 0, 0)';
        const size = Math.min(30, viewPoint.scale * 10);
        worldMap.forEachSupplyNode(supplyNode => {
            const province = renderedProvincesById[supplyNode.province];
            if (province) {
                const x = viewPoint.convertX(province.centerOfMass.x + xOffset);
                const y = viewPoint.convertY(province.centerOfMass.y);
                context.fillRect(x - size / 2, y - size / 2, size, size);
            }
        });
    }
    static renderRivers(renderContext, worldMap, context, xOffset) {
        const { viewPoint, topBar } = renderContext;
        const showRiverWarning = topBar.colorSet$.value === 'warnings' && topBar.warningFilter.selectedValues$.value.includes('river');
        const riverColors = [
            'rgb(0, 255, 0)',
            'rgb(255, 0, 0)',
            'rgb(255, 252, 0)',
            'rgb(0, 225, 255)',
            'rgb(0, 200, 255)',
            'rgb(0, 150, 255)',
            'rgb(0, 100, 255)',
            'rgb(0, 0, 255)',
            'rgb(0, 0, 255)',
            'rgb(0, 0, 200)',
            'rgb(0, 0, 150)',
            'rgb(0, 0, 100)',
        ];
        const warningColor = toColor(waterWarning);
        for (let i = 0; i < worldMap.rivers.length; i++) {
            const river = worldMap.rivers[i];
            if (!viewPoint.bboxInView(river.boundingBox, xOffset)) {
                continue;
            }
            const hasWarning = showRiverWarning && worldMap.getRiverWarnings(i).length > 0;
            for (const key in river.colors) {
                const index = parseInt(key, 10);
                const x = index % river.boundingBox.w + river.boundingBox.x;
                const y = Math.floor(index / river.boundingBox.w) + river.boundingBox.y;
                const color = river.colors[key];
                context.fillStyle = hasWarning && color >= 3 ? warningColor : riverColors[color];
                context.fillRect(viewPoint.convertX(x + xOffset), viewPoint.convertY(y), viewPoint.scale, viewPoint.scale);
            }
        }
    }
    static renderProvince(viewPoint, context, province, scale, xOffset = 0, overwriteRenderPrecision) {
        scale = scale !== null && scale !== void 0 ? scale : viewPoint.scale;
        const renderPrecisionBase = 2;
        const renderPrecision = scale < 1 ? Math.pow(2, Math.floor(Math.log2((1 / scale))) + (overwriteRenderPrecision !== undefined ? 0 : renderPrecisionBase)) :
            overwriteRenderPrecision !== null && overwriteRenderPrecision !== void 0 ? overwriteRenderPrecision : (scale <= renderPrecisionBase ? Math.pow(2, renderPrecisionBase + 1 - Math.round(scale)) : 1);
        const renderPrecisionMask = renderPrecision - 1;
        const renderPrecisionOffset = (renderPrecision - 1) / 2;
        for (const zone of province.coverZones) {
            if (zone.w < renderPrecision) {
                if ((zone.x & renderPrecisionMask) === 0 && (zone.y & renderPrecisionMask) === 0) {
                    context.fillRect(viewPoint.convertX(zone.x + xOffset - renderPrecisionOffset), viewPoint.convertY(zone.y - renderPrecisionOffset), renderPrecision * scale, renderPrecision * scale);
                }
            }
            else {
                context.fillRect(viewPoint.convertX(zone.x + xOffset - renderPrecisionOffset), viewPoint.convertY(zone.y - renderPrecisionOffset), zone.w * scale, zone.h * scale);
            }
        }
    }
    renderProvince(context, province, scale, xOffset = 0) {
        Renderer.renderProvince(this.viewPoint, context, province, scale, xOffset);
    }
    registerCanvasEventHandlers() {
        this.addSubscription((0, rxjs_1.fromEvent)(this.mainCanvas, 'mousemove').subscribe((e) => {
            this.cursorX = e.pageX;
            this.cursorY = e.pageY;
            this.renderCanvas();
        }));
    }
    renderHoverProvince(province, worldMap, renderAdjacent = true) {
        const backCanvasContext = this.backCanvasContext;
        const viewPoint = this.viewPoint;
        backCanvasContext.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.renderAllOffsets(province.boundingBox, worldMap.width, xOffset => this.renderProvince(backCanvasContext, province, viewPoint.scale, xOffset));
        if (!renderAdjacent) {
            return;
        }
        for (const adjecent of province.edges) {
            const adjecentNumber = adjecent.to;
            if (adjecentNumber === -1 || adjecent.type === 'impassable') {
                continue;
            }
            const adjecentProvince = worldMap.getProvinceById(adjecentNumber);
            if (adjecentProvince) {
                backCanvasContext.fillStyle = 'rgba(255, 255, 255, 0.3)';
                this.renderAllOffsets(adjecentProvince.boundingBox, worldMap.width, xOffset => this.renderProvince(backCanvasContext, adjecentProvince, viewPoint.scale, xOffset));
            }
        }
    }
    renderSelectedProvince(province, worldMap) {
        this.backCanvasContext.fillStyle = 'rgba(128, 255, 128, 0.7)';
        this.renderAllOffsets(province.boundingBox, worldMap.width, xOffset => this.renderProvince(this.backCanvasContext, province, this.viewPoint.scale, xOffset));
    }
    renderProvinceTooltip(province, worldMap) {
        const stateObject = worldMap.getStateByProvinceId(province.id);
        const strategicRegion = worldMap.getStrategicRegionByProvinceId(province.id);
        const supplyArea = stateObject ? worldMap.getSupplyAreaByStateId(stateObject.id) : undefined;
        const railwayLevel = worldMap.getRailwayLevelByProvinceId(province.id);
        const supplyNode = worldMap.getSupplyNodeByProvinceId(province.id);
        const vp = stateObject === null || stateObject === void 0 ? void 0 : stateObject.victoryPoints[province.id];
        this.renderTooltip(`
${(stateObject === null || stateObject === void 0 ? void 0 : stateObject.impassable) ? '|r|' + (0, i18n_1.feLocalize)('worldmap.tooltip.impassable', 'Impassable') : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.province', 'Province')}=${province.id}
${vp ? `${(0, i18n_1.feLocalize)('worldmap.tooltip.victorypoint', 'Victory point')}=${vp}` : ''}
${stateObject ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.state', 'State')}=${stateObject.id}` : ''}
${supplyArea ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplyarea', 'Supply area')}=${supplyArea.id}
` : ''}
${railwayLevel ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.railwaylevel', 'Railway level')}=${railwayLevel}
` : ''}
${supplyNode ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplynode', 'Supply node')}=true
` : ''}
${strategicRegion ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.strategicregion', 'Strategic region')}=${strategicRegion.id}
` : ''}
${stateObject ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.owner', 'Owner')}=${stateObject.owner}
${(0, i18n_1.feLocalize)('worldmap.tooltip.coreof', 'Core of')}=${stateObject.cores.join(',')}
${(0, i18n_1.feLocalize)('worldmap.tooltip.manpower', 'Manpower')}=${toCommaDivideNumber(stateObject.manpower)}` : ''}
${supplyArea ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplyvalue', 'Supply value')}=${supplyArea.value}
` : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.type', 'Type')}=${province.type}
${(0, i18n_1.feLocalize)('worldmap.tooltip.terrain', 'Terrain')}=${province.terrain}
${strategicRegion && strategicRegion.navalTerrain ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.navalterrain', 'Naval terrain')}=${strategicRegion.navalTerrain}
` : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.coastal', 'Coastal')}=${province.coastal}
${(0, i18n_1.feLocalize)('worldmap.tooltip.continent', 'Continent')}=${province.continent !== 0 ? `${worldMap.continents[province.continent]}(${province.continent})` : '0'}
${(0, i18n_1.feLocalize)('worldmap.tooltip.adjacencies', 'Adjecencies')}=${province.edges.filter(e => e.type !== 'impassable' && e.to !== -1).map(e => e.to).join(',')}
${worldMap.getProvinceWarnings(province, stateObject, strategicRegion, supplyArea).map(v => '|r|' + v).join('\n')}`);
    }
    renderLoadingText(text) {
        const backCanvasContext = this.backCanvasContext;
        backCanvasContext.font = '12px sans-serif';
        const mesurement = backCanvasContext.measureText(text);
        backCanvasContext.fillStyle = 'black';
        backCanvasContext.fillRect(0, topbar_1.topBarHeight, 20 + mesurement.width, 32);
        backCanvasContext.fillStyle = 'white';
        backCanvasContext.textAlign = 'start';
        backCanvasContext.textBaseline = 'top';
        backCanvasContext.fillText(text, 10, 10 + topbar_1.topBarHeight);
    }
    renderProvinceHoverSelection(worldMap) {
        let province = worldMap.getProvinceById(this.topBar.selectedProvinceId$.value);
        if (province) {
            this.renderSelectedProvince(province, worldMap);
        }
        province = worldMap.getProvinceById(this.topBar.hoverProvinceId$.value);
        if (province) {
            if (this.topBar.selectedProvinceId$ !== this.topBar.hoverProvinceId$ && this.isMouseHighlightVisible()) {
                this.renderHoverProvince(province, worldMap);
            }
            if (this.isTooltipVisible()) {
                this.renderProvinceTooltip(province, worldMap);
            }
        }
    }
    renderStateHoverSelection(worldMap) {
        const hover = worldMap.getStateById(this.topBar.hoverStateId$.value);
        this.renderHoverSelection(worldMap, hover, worldMap.getStateById(this.topBar.selectedStateId$.value));
        hover && this.isTooltipVisible() && this.renderStateTooltip(hover, worldMap);
    }
    renderStrategicRegionHoverSelection(worldMap) {
        const hover = worldMap.getStrategicRegionById(this.topBar.hoverStrategicRegionId$.value);
        this.renderHoverSelection(worldMap, hover, worldMap.getStrategicRegionById(this.topBar.selectedStrategicRegionId$.value));
        hover && this.isTooltipVisible() && this.renderStrategicRegionTooltip(hover, worldMap);
    }
    renderSupplyAreaHoverSelection(worldMap) {
        const hover = worldMap.getSupplyAreaById(this.topBar.hoverSupplyAreaId$.value);
        const selected = worldMap.getSupplyAreaById(this.topBar.selectedSupplyAreaId$.value);
        const toProvinces = (supplyArea) => {
            return supplyArea ?
                {
                    provinces: (0, lodash_1.chain)(supplyArea.states)
                        .map(stateId => { var _a; return (_a = worldMap.getStateById(stateId)) === null || _a === void 0 ? void 0 : _a.provinces; })
                        .filter((v) => !!v)
                        .flatten()
                        .value()
                } :
                undefined;
        };
        this.renderHoverSelection(worldMap, toProvinces(hover), toProvinces(selected));
        hover && this.isTooltipVisible() && this.renderSupplyAreaTooltip(hover, worldMap);
    }
    renderHoverSelection(worldMap, hover, selected) {
        if (selected) {
            for (const provinceId of selected.provinces) {
                const province = worldMap.getProvinceById(provinceId);
                if (province) {
                    this.renderSelectedProvince(province, worldMap);
                }
            }
        }
        if (hover && this.isMouseHighlightVisible() && hover !== selected) {
            for (const provinceId of hover.provinces) {
                const province = worldMap.getProvinceById(provinceId);
                if (province) {
                    this.renderHoverProvince(province, worldMap, false);
                }
            }
        }
    }
    renderStateTooltip(state, worldMap) {
        const supplyArea = worldMap.getSupplyAreaByStateId(state.id);
        this.renderTooltip(`
${state.impassable ? '|r|' + (0, i18n_1.feLocalize)('worldmap.tooltip.impassable', 'Impassable') : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.state', 'State')}=${state.id}
${supplyArea ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplyarea', 'Supply area')}=${supplyArea.id}
` : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.owner', 'Owner')}=${state.owner}
${(0, i18n_1.feLocalize)('worldmap.tooltip.coreof', 'Core of')}=${state.cores.join(',')}
${(0, i18n_1.feLocalize)('worldmap.tooltip.manpower', 'Manpower')}=${toCommaDivideNumber(state.manpower)}
${(0, i18n_1.feLocalize)('worldmap.tooltip.category', 'Category')}=${state.category}
${supplyArea ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplyvalue', 'Supply value')}=${supplyArea.value}
` : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.provinces', 'Provinces')}=${state.provinces.join(',')}
${worldMap.getStateWarnings(state, supplyArea).map(v => '|r|' + v).join('\n')}`, (width, height) => {
            const { width: w, height: h } = Renderer.getResourcesSize(state);
            return { width: Math.max(width, w), height: height + h };
        }, (x, y) => {
            Renderer.renderResources(this.backCanvasContext, state, x, y);
        });
    }
    renderStrategicRegionTooltip(strategicRegion, worldMap) {
        this.renderTooltip(`
${(0, i18n_1.feLocalize)('worldmap.tooltip.strategicregion', 'Strategic region')}=${strategicRegion.id}
${strategicRegion.navalTerrain ? `
${(0, i18n_1.feLocalize)('worldmap.tooltip.navalterrain', 'Naval terrain')}=${strategicRegion.navalTerrain}
` : ''}
${(0, i18n_1.feLocalize)('worldmap.tooltip.provinces', 'Provinces')}=${strategicRegion.provinces.join(',')}
${worldMap.getStrategicRegionWarnings(strategicRegion).map(v => '|r|' + v).join('\n')}`);
    }
    renderSupplyAreaTooltip(supplyArea, worldMap) {
        this.renderTooltip(`
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplyarea', 'Supply area')}=${supplyArea.id}
${(0, i18n_1.feLocalize)('worldmap.tooltip.supplyvalue', 'Supply value')}=${supplyArea.value}
${(0, i18n_1.feLocalize)('worldmap.tooltip.states', 'States')}=${supplyArea.states.join(',')}
${worldMap.getSupplyAreaWarnings(supplyArea).map(v => '|r|' + v).join('\n')}`);
    }
    renderTooltip(tooltip, sizeCallback, renderCallback) {
        var _a;
        const backCanvasContext = this.backCanvasContext;
        const cursorX = this.cursorX;
        const cursorY = this.cursorY;
        let mapX = this.viewPoint.convertBackX(cursorX);
        if (this.loader.worldMap.width > 0 && mapX >= this.loader.worldMap.width) {
            mapX -= this.loader.worldMap.width;
        }
        const mapY = this.viewPoint.convertBackY(cursorY);
        tooltip = `(${mapX}, ${mapY})\nX=${mapX}, Z=${this.loader.worldMap.height - 1 - mapY}\n` + tooltip;
        const colorPrefix = /^\|r\|/;
        const regex = /(\n)|((?:\|r\|)?(?:.{40,59}[, ]|.{60}))/g;
        const text = tooltip.trim()
            .split(regex)
            .map((v, i, a) => {
            if (!(v === null || v === void 0 ? void 0 : v.trim()) || colorPrefix.test(v)) {
                return v;
            }
            for (let j = i - 1; j >= 0; j--) {
                if (!a[j] || a[j] === '\n') {
                    return v;
                }
                const match = colorPrefix.exec(a[j]);
                if (match) {
                    return match[0] + v;
                }
            }
            return v;
        })
            .filter(v => v === null || v === void 0 ? void 0 : v.trim());
        const fontSize = 14;
        let toolTipOffsetX = 10;
        let toolTipOffsetY = 10;
        const marginX = 10;
        const marginY = 10;
        const linePadding = 3;
        backCanvasContext.font = `${fontSize}px sans-serif`;
        backCanvasContext.textAlign = 'start';
        let width = (_a = (0, lodash_1.max)(text.map(t => backCanvasContext.measureText(t).width))) !== null && _a !== void 0 ? _a : 0;
        let height = fontSize * text.length + linePadding * (text.length - 1);
        if (cursorX + toolTipOffsetX + width + 2 * marginX > this.canvasWidth) {
            toolTipOffsetX = -10 - (width + 2 * marginX);
        }
        if (cursorY + toolTipOffsetY + height + 2 * marginY > this.canvasHeight) {
            toolTipOffsetY = -10 - (height + 2 * marginY);
        }
        backCanvasContext.strokeStyle = '#7F7F7F';
        backCanvasContext.fillStyle = 'white';
        backCanvasContext.textBaseline = 'top';
        if (sizeCallback) {
            const result = sizeCallback(width, height);
            width = result.width;
            height = result.height;
        }
        backCanvasContext.fillRect(cursorX + toolTipOffsetX, cursorY + toolTipOffsetY, width + 2 * marginX, height + 2 * marginY);
        backCanvasContext.strokeRect(cursorX + toolTipOffsetX, cursorY + toolTipOffsetY, width + 2 * marginX, height + 2 * marginY);
        text.forEach((t, i) => {
            backCanvasContext.fillStyle = 'black';
            if (t.startsWith('|r|')) {
                backCanvasContext.fillStyle = 'red';
                t = t.substring(3);
            }
            t = t.trim();
            backCanvasContext.fillText(t, cursorX + toolTipOffsetX + marginX, cursorY + toolTipOffsetY + marginY + i * (fontSize + linePadding));
        });
        backCanvasContext.fillStyle = 'black';
        if (renderCallback) {
            renderCallback(cursorX + toolTipOffsetX + marginX, cursorY + toolTipOffsetY + marginY + text.length * (fontSize + linePadding));
        }
    }
    static renderAllOffsets(viewPoint, boundingBox, step, callback, minimalRenderCount = 1) {
        let xOffset = 0;
        let i = 0;
        let inView = viewPoint.bboxInView(boundingBox, xOffset);
        while (inView || i < minimalRenderCount) {
            if (inView) {
                callback(xOffset);
            }
            if (step <= 0) {
                return;
            }
            xOffset += step;
            i++;
            inView = viewPoint.bboxInView(boundingBox, xOffset);
        }
    }
    renderAllOffsets(boundingBox, step, callback, minimalRenderCount = 1) {
        Renderer.renderAllOffsets(this.viewPoint, boundingBox, step, callback, minimalRenderCount);
    }
    static getResourcesSize(state, scale = 1, labelWidth = 30) {
        let fullWidth = 0;
        let maxHeight = 0;
        for (const resource in state.resources) {
            if (!state.resources[resource]) {
                continue;
            }
            const image = Renderer.resourceImages[resource];
            if (image) {
                maxHeight = Math.max(maxHeight, image.naturalHeight * scale);
                fullWidth += image.naturalWidth * scale;
            }
            else {
                maxHeight = Math.max(maxHeight, 24 * scale);
                fullWidth += 24 * scale;
            }
            fullWidth += labelWidth;
        }
        return { width: fullWidth, height: maxHeight };
    }
    static renderResources(context, state, x, y, scale = 1, labelWidth = 30) {
        var _a, _b, _c;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (const resource in state.resources) {
            const resourceNumber = state.resources[resource];
            if (!resourceNumber) {
                continue;
            }
            const image = Renderer.resourceImages[resource];
            if (image) {
                context.drawImage(image, x, y, image.naturalWidth * scale, image.naturalHeight * scale);
                context.fillText(resourceNumber.toString(), x + ((_a = image === null || image === void 0 ? void 0 : image.naturalWidth) !== null && _a !== void 0 ? _a : 0) * scale + labelWidth / 2, y + Math.max(0, (_b = image === null || image === void 0 ? void 0 : image.naturalHeight) !== null && _b !== void 0 ? _b : 0) * scale / 2);
                x += ((_c = image === null || image === void 0 ? void 0 : image.naturalWidth) !== null && _c !== void 0 ? _c : 0) * scale + labelWidth;
            }
            else {
                context.fillStyle = 'gray';
                context.fillRect(x, y, 24 * scale, 24 * scale);
                context.fillText(resourceNumber.toString(), x + 24 * scale + labelWidth / 2, y + 24 * scale / 2);
                x += 24 * scale + labelWidth;
            }
        }
    }
}
exports.Renderer = Renderer;
Renderer.resourceImages = {};
function toColor(colorNum) {
    return '#' + (0, lodash_1.padStart)(colorNum.toString(16), 6, '0');
}
function findNearestPoints(start, end, a, b) {
    if (start && end) {
        return [start, end];
    }
    if (!b) {
        return [(0, graphutils_1.bboxCenter)(a.boundingBox), (0, graphutils_1.bboxCenter)(a.boundingBox)];
    }
    ;
    if (!start) {
        const t = start, u = a;
        start = end;
        a = b;
        end = t;
        b = u;
    }
    if (!start) {
        let nearestPair = undefined;
        let nearestPairDistance = 1e10;
        for (const ape of a.edges) {
            for (const ap of ape.path) {
                for (const app of ap) {
                    for (const bpe of b.edges) {
                        for (const bp of bpe.path) {
                            for (const bpp of bp) {
                                const disSqr = (0, graphutils_1.distanceSqr)(app, bpp);
                                if (disSqr < nearestPairDistance) {
                                    nearestPairDistance = disSqr;
                                    nearestPair = [app, bpp];
                                }
                            }
                        }
                    }
                }
            }
        }
        return nearestPair !== null && nearestPair !== void 0 ? nearestPair : [(0, graphutils_1.bboxCenter)(a.boundingBox), (0, graphutils_1.bboxCenter)(a.boundingBox)];
    }
    else {
        let nearestPair = undefined;
        let nearestPairDistance = 1e10;
        for (const bpe of b.edges) {
            for (const bp of bpe.path) {
                for (const bpp of bp) {
                    const disSqr = (0, graphutils_1.distanceSqr)(start, bpp);
                    if (disSqr < nearestPairDistance) {
                        nearestPairDistance = disSqr;
                        nearestPair = [start, bpp];
                    }
                }
            }
        }
        return nearestPair !== null && nearestPair !== void 0 ? nearestPair : [(0, graphutils_1.bboxCenter)(a.boundingBox), (0, graphutils_1.bboxCenter)(a.boundingBox)];
    }
}
function getColorByColorSet(colorSet, province, worldMap, renderContext) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { provinceToState, provinceToStrategicRegion, stateToSupplyArea, topBar } = renderContext;
    switch (colorSet) {
        case 'provincetype':
            return (province.type === 'land' ? 0x007F00 : province.type === 'lake' ? 0x00FFFF : 0x00007F) | (province.coastal ? 0x7F0000 : 0);
        case 'country':
            {
                const stateId = provinceToState[province.id];
                return (_b = (_a = worldMap.countries.find(c => { var _a; return c && c.tag === ((_a = worldMap.getStateById(stateId)) === null || _a === void 0 ? void 0 : _a.owner); })) === null || _a === void 0 ? void 0 : _a.color) !== null && _b !== void 0 ? _b : defaultColor(province);
            }
        case 'terrain':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = (0, common_1.arrayToMap)(worldMap.terrains, 'name');
                }
                const navalTerrain = province.type === 'land' ? undefined : (_c = worldMap.getStrategicRegionById(provinceToStrategicRegion[province.id])) === null || _c === void 0 ? void 0 : _c.navalTerrain;
                return (_e = (_d = renderContext.extraState[navalTerrain !== null && navalTerrain !== void 0 ? navalTerrain : province.terrain]) === null || _d === void 0 ? void 0 : _d.color) !== null && _e !== void 0 ? _e : 0;
            }
        case 'continent':
            if (renderContext.extraState === undefined) {
                let continent = 0;
                worldMap.forEachProvince(p => (p.continent > continent ? continent = p.continent : 0, false));
                renderContext.extraState = avoidPowerOf2(continent + 1);
            }
            return province.continent !== 0 ? valueAndMaxToColor(province.continent + 1, renderContext.extraState) : defaultColor(province);
        case 'stateid':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = avoidPowerOf2(worldMap.statesCount);
                }
                const stateId = provinceToState[province.id];
                return stateId !== undefined ? valueAndMaxToColor(stateId < 0 ? 0 : stateId, renderContext.extraState) : defaultColor(province);
            }
        case 'warnings':
            {
                const isLand = province.type === 'land';
                const viewMode = topBar.viewMode$.value;
                const warningFilter = topBar.warningFilter.selectedValues$.value;
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const strategicRegion = worldMap.getStrategicRegionById(provinceToStrategicRegion[province.id]);
                const supplyAreaId = stateId ? stateToSupplyArea[stateId] : undefined;
                const supplyArea = worldMap.getSupplyAreaById(supplyAreaId);
                return worldMap.getProvinceWarnings(viewMode !== "warnings" || warningFilter.includes('province') ? province : undefined, viewMode !== "warnings" || warningFilter.includes('state') ? state : undefined, viewMode !== "warnings" || warningFilter.includes('strategicregion') ? strategicRegion : undefined, viewMode !== "warnings" || warningFilter.includes('supplyarea') ? supplyArea : undefined).length > 0 ?
                    (isLand ? landWarning : waterWarning) :
                    (isLand ? landNoWarning : waterNoWarning);
            }
        case 'manpower':
            {
                if (province.type === 'sea') {
                    return defaultColor(province);
                }
                if (renderContext.extraState === undefined) {
                    let maxManpower = 0;
                    worldMap.forEachState(state => (state.manpower > maxManpower ? maxManpower = state.manpower : 0, false));
                    renderContext.extraState = maxManpower;
                }
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const value = manpowerHandler((_f = state === null || state === void 0 ? void 0 : state.manpower) !== null && _f !== void 0 ? _f : 0) / manpowerHandler(renderContext.extraState);
                return valueToColorGYR(value);
            }
        case 'victorypoint':
            {
                if (renderContext.extraState === undefined) {
                    let maxVictoryPoint = 0;
                    worldMap.forEachState(state => Object.values(state.victoryPoints).forEach(vp => vp !== undefined && vp > maxVictoryPoint ? maxVictoryPoint = vp : 0));
                    renderContext.extraState = maxVictoryPoint;
                }
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const value = victoryPointsHandler(state ? (_g = state.victoryPoints[province.id]) !== null && _g !== void 0 ? _g : 0.1 : 0) / victoryPointsHandler(renderContext.extraState);
                return valueToColorGreyScale(value);
            }
        case 'resources':
            {
                if (province.type === 'sea') {
                    return defaultColor(province);
                }
                if (renderContext.extraState === undefined) {
                    let maxResources = 0;
                    worldMap.forEachState(state => {
                        const numResources = Object.values(state.resources).reduce((p, c) => p + (c !== null && c !== void 0 ? c : 0), 0);
                        if (numResources > maxResources) {
                            maxResources = numResources;
                        }
                        return false;
                    });
                    renderContext.extraState = maxResources;
                }
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const numResources = state ? Object.values(state.resources).reduce((p, c) => p + (c !== null && c !== void 0 ? c : 0), 0) : 0;
                const value = resourcesHandler(numResources) / resourcesHandler(renderContext.extraState);
                return valueToColorGYR(value);
            }
        case 'strategicregionid':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = avoidPowerOf2(worldMap.strategicRegionsCount);
                }
                const strategicRegionId = provinceToStrategicRegion[province.id];
                return valueAndMaxToColor(strategicRegionId === undefined || strategicRegionId < 0 ? 0 : strategicRegionId, renderContext.extraState);
            }
        case 'supplyareaid':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = avoidPowerOf2(worldMap.supplyAreasCount);
                }
                const stateId = provinceToState[province.id];
                const supplyAreaId = stateId !== undefined ? stateToSupplyArea[stateId] : undefined;
                return supplyAreaId !== undefined ? valueAndMaxToColor(supplyAreaId < 0 ? 0 : supplyAreaId, renderContext.extraState) : defaultColor(province);
            }
        case 'supplyvalue':
            {
                if (province.type === 'sea') {
                    return defaultColor(province);
                }
                if (renderContext.extraState === undefined) {
                    let maxSupplyValue = 0;
                    worldMap.forEachSupplyArea(supplyArea => (supplyArea.value > maxSupplyValue ? maxSupplyValue = supplyArea.value : 0, false));
                    renderContext.extraState = maxSupplyValue;
                }
                const stateId = provinceToState[province.id];
                const supplyAreaId = stateId ? stateToSupplyArea[stateId] : undefined;
                const supplyArea = worldMap.getSupplyAreaById(supplyAreaId);
                const value = ((_h = supplyArea === null || supplyArea === void 0 ? void 0 : supplyArea.value) !== null && _h !== void 0 ? _h : 0) / (renderContext.extraState);
                return valueToColorGYR(value);
            }
        default:
            return province.color;
    }
}
function manpowerHandler(manpower) {
    if (manpower < 0) {
        manpower = 0;
    }
    return Math.pow(manpower, 0.2);
}
function victoryPointsHandler(victoryPoints) {
    if (victoryPoints < 0) {
        victoryPoints = 0;
    }
    return Math.pow(victoryPoints, 0.5);
}
function resourcesHandler(resources) {
    if (resources < 0) {
        resources = 0;
    }
    return Math.pow(resources, 0.2);
}
function valueToColorRYG(value) {
    return value < 0.5 ? (0xFF0000 | (Math.floor(255 * 2 * value) << 8)) : (0xFF00 | (Math.floor(255 * 2 * (1 - value)) << 16));
}
function valueToColorGYR(value) {
    return value < 0.5 ? (0xFF00 | (Math.floor(255 * 2 * value) << 16)) : (0xFF0000 | (Math.floor(255 * 2 * (1 - value)) << 8));
}
function valueToColorBCG(value) {
    return value < 0.5 ? (0xFF | (Math.floor(255 * 2 * value) << 8)) : (0xFF00 | Math.floor(255 * 2 * (1 - value)));
}
function valueToColorGreyScale(value) {
    return Math.floor(value * 255) * 0x10101;
}
function valueAndMaxToColor(value, max) {
    return Math.floor(value * (0xFFFFFF / max));
}
function getHighConstrastColor(color) {
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    return r * 0.7 + g * 2 + b * 0.3 > 3 * 0x7F ? 0 : 0xFFFFFF;
}
function avoidPowerOf2(value) {
    const v = Math.log2(value);
    if (v > 0 && (v >>> 0) === v) {
        return value + 1;
    }
    return value;
}
function isCriticalPoint(path, index) {
    return index === 0 || index === path.length - 1 ||
        ((0, graphutils_1.distanceHamming)(path[index], path[index - 1]) > 2 && (0, graphutils_1.distanceHamming)(path[index], path[index + 1]) > 2);
}
function defaultColor(province) {
    return province.type === 'land' ? 0 : 0x1010B0;
}
function toCommaDivideNumber(value) {
    return value.toString(10).replace(/(?<!^)(\d{3})(?=(?:\d{3})*$)/g, ',$1');
}
//# sourceMappingURL=renderer.js.map