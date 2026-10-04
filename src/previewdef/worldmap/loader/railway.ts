import { readFileFromModOrHOI4 } from "../../../util/fileloader";
import { localize } from "../../../util/i18n";
import { LoaderSession } from "../../../util/loader/loader";
import { Province, Railway, SupplyNode, WorldMapWarning } from "../definitions";
import { FileLoader, LoadResult, LoadResultOD } from "./common";
import { DefaultMapLoader } from "./provincemap";

abstract class DefaultMapDependentLoader<T> extends FileLoader<T> {
    constructor(file: string, private defaultMapLoader: DefaultMapLoader, private progress: [Parameters<typeof localize>[0], string]) {
        super(file);
    }

    public override async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
        return await super.shouldReloadImpl(session) || await this.defaultMapLoader.shouldReload(session);
    }
    
    protected override async loadImpl(session: LoaderSession): Promise<LoadResult<T>> {
        await this.fireOnProgressEvent(localize(...this.progress));
        return super.loadImpl(session);
    }
    
    protected async loadFromFile(session: LoaderSession): Promise<LoadResultOD<T>> {
        const provinceMap = await this.defaultMapLoader.load(session);
        const warnings: WorldMapWarning[] = [];
        return { result: await this.loadMapData(provinceMap.result.provinces, warnings), warnings };
    }

    protected abstract loadMapData(provinces: (Province | null | undefined)[], warnings: WorldMapWarning[]): Promise<T>;
}

type RailwayLoaderResult = { railways: Railway[]; };
export class RailwayLoader extends DefaultMapDependentLoader<RailwayLoaderResult> {
    constructor(defaultMapLoader: DefaultMapLoader) {
        super('map/railways.txt', defaultMapLoader, ['worldmap.progress.loadingrailways', 'Loading railways...']);
    }

    protected async loadMapData(provinces: (Province | null | undefined)[], warnings: WorldMapWarning[]): Promise<RailwayLoaderResult> {
        return { railways: await loadRailway(provinces, this.file, warnings) };
    }

    public override toString() {
        return `[RailwayLoader: ${this.file}]`;
    }
}

async function readSupplyLines(file: string, minFields: number): Promise<number[][]> {
    const [buffer] = await readFileFromModOrHOI4(file);
    return buffer.toString().split(/(?:\r\n|\n|\r)/)
        .map(line => line.trimStart().split(/\s+/).map(v => parseInt(v)))
        .filter(line => line.length >= minFields);
}

async function loadRailway(provinces: (Province | null | undefined)[], file: string, warnings: WorldMapWarning[]): Promise<Railway[]> {
    const railwaysRaw = await readSupplyLines(file, 3);
    const railways = railwaysRaw.map((line, index) => {
        const level = line[0] ?? 0;
        const provinceCount = line[1] ?? 0;
        if (provinceCount + 2 > line.length) {
            warnings.push({
                source: [{ type: 'railway', id: index }],
                relatedFiles: [file],
                text: localize('worldmap.warnings.railwaylinecountnotenough', 'Not enough provinces in railway: {0}', line),
            });
        }
        return {
            level,
            provinces: line.slice(2, Math.min(provinceCount + 2, line.length)),
        };
    });

    validateRailways(provinces, file, railways, warnings);

    return railways;
}

function validateRailways(provinces: (Province | null | undefined)[], file: string, railways: Railway[], warnings: WorldMapWarning[]): void {
    railways.forEach(railway => {
        railway.provinces.forEach((provinceId, index) => {
            const province = provinces[provinceId];
            if (!province) {
                warnings.push({
                    source: [{ type: 'railway', id: index }, { type: 'province', id: provinceId, color: 0 }],
                    text: localize('worldmap.warnings.provincenotexist', 'Province with id {0} doesn\'t exist.', provinceId),
                    relatedFiles: [file],
                });
            } else if (index > 0) {
                const lastProvinceId = railway.provinces[index - 1];
                if (lastProvinceId === undefined) {
                    return;
                }
                const hasEdge = province.edges.filter(e => e.to === lastProvinceId && e.type !== 'impassable').length > 0;
                if (!hasEdge) {
                    warnings.push({
                        source: [{ type: 'railway', id: index }, { type: 'province', id: provinceId, color: 0 }, { type: 'province', id: lastProvinceId, color: 0 }],
                        text: localize('worldmap.warnings.provincenotadjacent', 'Province {0}, {1} are not adjacent.', provinceId, lastProvinceId),
                        relatedFiles: [file],
                    });
                }
            }
        });
    });
}

type SupplyNodeLoaderResult = { supplyNodes: SupplyNode[]; };
export class SupplyNodeLoader extends DefaultMapDependentLoader<SupplyNodeLoaderResult> {
    constructor(defaultMapLoader: DefaultMapLoader) {
        super('map/supply_nodes.txt', defaultMapLoader, ['worldmap.progress.loadingsupplynodes', 'Loading supply nodes...']);
    }

    protected async loadMapData(provinces: (Province | null | undefined)[], warnings: WorldMapWarning[]): Promise<SupplyNodeLoaderResult> {
        return { supplyNodes: await loadSupplyNodes(provinces, this.file, warnings) };
    }

    public override toString() {
        return `[SupplyNodeLoader: ${this.file}]`;
    }
}

async function loadSupplyNodes(provinces: (Province | null | undefined)[], file: string, warnings: WorldMapWarning[]): Promise<SupplyNode[]> {
    const supplyNodesRaw = await readSupplyLines(file, 2);
    const supplyNodes = supplyNodesRaw.map((line, index) => {
        const provinceId = line[1] ?? 0;
        const level = line[0] ?? 0;
        if (!provinces[provinceId]) {
            warnings.push({
                source: [{ type: 'supplynode', id: index }, { type: 'province', id: provinceId, color: 0 }],
                text: localize('worldmap.warnings.provincenotexist', 'Province with id {0} doesn\'t exist.', provinceId),
                relatedFiles: [file],
            });
        }
        return {
            level,
            province: provinceId,
        };
    });

    return supplyNodes;
}

