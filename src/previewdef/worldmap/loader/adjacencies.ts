import { readFileFromModOrHOI4 } from "../../../util/fileloader";
import { localize } from "../../../util/i18n";
import { Point, ProgressReporter, ProvinceEdgeAdjacency, WorldMapWarning } from "../definitions";
import { FileLoader, LoadResultOD } from "./common";

export class AdjacenciesLoader extends FileLoader<ProvinceEdgeAdjacency[]> {
    protected async loadFromFile(): Promise<LoadResultOD<ProvinceEdgeAdjacency[]>> {
        const warnings: WorldMapWarning[] = [];
        return {
            result: await loadAdjacencies(this.file, e => this.fireOnProgressEvent(e), warnings),
            warnings,
        };
    }

    public toString() {
        return `[AdjacenciesLoader: ${this.file}]`;
    }
}

async function loadAdjacencies(adjacenciesFile: string, progressReporter: ProgressReporter, warnings: WorldMapWarning[]): Promise<ProvinceEdgeAdjacency[]> {
    await progressReporter(localize('worldmap.progress.loadingadjacencies', 'Loading adjecencies...'));

    const [adjecenciesBuffer] = await readFileFromModOrHOI4(adjacenciesFile);
    const adjecencies = adjecenciesBuffer.toString().split(/(?:\r\n|\n|\r)/).map(line => line.split(/[,;]/)).filter((v, i) => i > 0 && v.length >= 9);

    return adjecencies.map(row => convertRowToAdjacencies(row, warnings)).filter((v): v is ProvinceEdgeAdjacency => !!v);
}

function convertRowToAdjacencies(adjacency: string[], _warnings: WorldMapWarning[]): ProvinceEdgeAdjacency | undefined {
    const fromValue = adjacency[0];
    const toValue = adjacency[1];
    const type = adjacency[2] ?? '';
    const throughValue = adjacency[3];
    const startXValue = adjacency[4] ?? '';
    const startYValue = adjacency[5] ?? '';
    const stopXValue = adjacency[6] ?? '';
    const stopYValue = adjacency[7] ?? '';
    const rule = adjacency[8] ?? '';
    if (!fromValue || !toValue || !throughValue) {
        return undefined;
    }
    const from = parseInt(fromValue);
    const to = parseInt(toValue);
    const through = parseInt(throughValue);
    const startX = parseInt(startXValue);
    const startY = parseInt(startYValue);
    const stopX = parseInt(stopXValue);
    const stopY = parseInt(stopYValue);

    if (from === -1 || to === -1) {
        return undefined;
    }

    const start: Point | undefined = !isNaN(startX) && !isNaN(startY) && startX !== -1 && startY !== -1 ? { x: startX, y: startY } : undefined;
    const stop: Point | undefined = !isNaN(stopX) && !isNaN(stopY) && stopX !== -1 && stopY !== -1 ? { x: stopX, y: stopY } : undefined;

    return {
        from,
        to,
        type,
        through,
        start,
        stop,
        rule,
        row: adjacency,
    };
}
