import * as assert from 'assert';
import { Point, ProvinceEdgeGraph, WorldMapWarning } from '../previewdef/worldmap/definitions';
import { concatEdges, fillEdges, validateProvince } from '../previewdef/worldmap/loader/provincebmp';
import { localize } from '../util/i18n';

function pt(x: number, y: number): Point {
    return { x, y };
}

function seg(x1: number, y1: number, x2: number, y2: number): [Point, Point] {
    return [pt(x1, y1), pt(x2, y2)];
}

// Build a fillEdges input from a height*width grid of colors (row-major, y*width+x).
function buildGrid(colors: number[][]): {
    provinces: { color: number }[];
    colorByPosition: Uint32Array;
    width: number;
    height: number;
} {
    const height = colors.length;
    const width = colors[0].length;
    const colorByPosition = new Uint32Array(width * height);
    const seenColors = new Set<number>();
    const provinces: { color: number }[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const color = colors[y][x];
            colorByPosition[y * width + x] = color;
            if (!seenColors.has(color)) {
                seenColors.add(color);
                provinces.push({ color });
            }
        }
    }
    return { provinces, colorByPosition, width, height };
}

function edgesOf(provinces: { color: number; edges: ProvinceEdgeGraph[] }[], color: number): ProvinceEdgeGraph[] {
    return provinces.find(p => p.color === color)!.edges;
}

describe('worldmap/provincebmp edge joining', function () {
    describe('concatEdges', function () {
        it('joins a shuffled unit square into a single closed path', function () {
            // Directed unit-square boundary segments, chained as a cycle, fed out of order.
            const edges: [Point, Point][] = [
                seg(1, 0, 1, 1),
                seg(0, 1, 0, 0),
                seg(0, 0, 1, 0),
                seg(1, 1, 0, 1),
            ];
            assert.deepStrictEqual(concatEdges(edges), [[
                pt(0, 1), pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1),
            ]]);
        });

        it('collapses collinear points on a 2x1 rectangle', function () {
            const edges: [Point, Point][] = [
                seg(0, 0, 1, 0),
                seg(1, 0, 2, 0),
                seg(2, 0, 2, 1),
                seg(2, 1, 1, 1),
                seg(1, 1, 0, 1),
                seg(0, 1, 0, 0),
            ];
            assert.deepStrictEqual(concatEdges(edges), [[
                pt(2, 1), pt(0, 1), pt(0, 0), pt(2, 0), pt(2, 1),
            ]]);
        });

        it('returns two paths for two disjoint loops fed in one call', function () {
            const edges: [Point, Point][] = [
                // square A at origin
                seg(0, 0, 1, 0),
                seg(1, 0, 1, 1),
                seg(1, 1, 0, 1),
                seg(0, 1, 0, 0),
                // square B far away
                seg(5, 5, 6, 5),
                seg(6, 5, 6, 6),
                seg(6, 6, 5, 6),
                seg(5, 6, 5, 5),
            ];
            assert.deepStrictEqual(concatEdges(edges), [
                [pt(1, 1), pt(0, 1), pt(0, 0), pt(1, 0), pt(1, 1)],
                [pt(6, 6), pt(5, 6), pt(5, 5), pt(6, 5), pt(6, 6)],
            ]);
        });

        it('returns an empty result for empty input', function () {
            assert.deepStrictEqual(concatEdges([]), []);
        });

        it('collapses an already-collinear open segment pair to its endpoints', function () {
            const edges: [Point, Point][] = [
                seg(0, 0, 1, 0),
                seg(1, 0, 2, 0),
            ];
            assert.deepStrictEqual(concatEdges(edges), [[pt(0, 0), pt(2, 0)]]);
        });

        it('keeps points apart whose x and y would collide under a too-small key stride', function () {
            // With a stride of 3, (0, 3) and (1, 0) would share a key and the two segments
            // would wrongly chain into one path.
            const edges: [Point, Point][] = [
                seg(5, 5, 0, 3),
                seg(1, 0, 2, 0),
            ];
            assert.deepStrictEqual(concatEdges(edges), [
                [pt(5, 5), pt(0, 3)],
                [pt(1, 0), pt(2, 0)],
            ]);
        });
    });

    describe('fillEdges', function () {
        // Horizontal wrap-around (cylinder map): the left column of A borders B, so
        // A<->B appears on both x=0 and x=2. Top/bottom border edges carry toColor -1.
        it('buckets edges by toColor for two provinces sharing a border', function () {
            const A = 0xaa0000; // 11141120
            const B = 0x0000bb; // 187
            const grid = buildGrid([
                [A, A, B, B],
                [A, A, B, B],
            ]);
            const provinces = fillEdges(grid.provinces, grid.colorByPosition, grid.width, grid.height);

            assert.deepStrictEqual(edgesOf(provinces, A), [
                { toColor: B, path: [[pt(0, 2), pt(0, 0)], [pt(2, 0), pt(2, 2)]] },
                { toColor: -1, path: [[pt(0, 0), pt(2, 0)], [pt(2, 2), pt(0, 2)]] },
            ]);
            assert.deepStrictEqual(edgesOf(provinces, B), [
                { toColor: A, path: [[pt(2, 2), pt(2, 0)], [pt(4, 0), pt(4, 2)]] },
                { toColor: -1, path: [[pt(2, 0), pt(4, 0)], [pt(4, 2), pt(2, 2)]] },
            ]);
        });

        it('produces full toColor-bucketed edge sets for a 3-province grid', function () {
            const A = 0x111111; // 1118481
            const B = 0x222222; // 2236962
            const C = 0x333333; // 3355443
            const grid = buildGrid([
                [A, A, B, B],
                [A, A, B, B],
                [C, C, C, C],
                [C, C, C, C],
            ]);
            const provinces = fillEdges(grid.provinces, grid.colorByPosition, grid.width, grid.height);

            assert.deepStrictEqual(edgesOf(provinces, A), [
                { toColor: B, path: [[pt(0, 2), pt(0, 0)], [pt(2, 0), pt(2, 2)]] },
                { toColor: C, path: [[pt(2, 2), pt(0, 2)]] },
                { toColor: -1, path: [[pt(0, 0), pt(2, 0)]] },
            ]);
            assert.deepStrictEqual(edgesOf(provinces, B), [
                { toColor: A, path: [[pt(2, 2), pt(2, 0)], [pt(4, 0), pt(4, 2)]] },
                { toColor: C, path: [[pt(4, 2), pt(2, 2)]] },
                { toColor: -1, path: [[pt(2, 0), pt(4, 0)]] },
            ]);
            assert.deepStrictEqual(edgesOf(provinces, C), [
                { toColor: A, path: [[pt(0, 2), pt(2, 2)]] },
                { toColor: B, path: [[pt(2, 2), pt(4, 2)]] },
                { toColor: -1, path: [[pt(4, 4), pt(0, 4)]] },
            ]);
        });

        // Reference matching the pre-optimization implementation: a [color, [Point, Point]]
        // tuple per boundary side, grouped per neighbour, joined on "x,y" string keys with a
        // linear scan. The numeric version must produce identical edge sets.
        function fillEdgesReference(colors: number[][]): { color: number; edges: ProvinceEdgeGraph[] }[] {
            const grid = buildGrid(colors);
            const { colorByPosition, width, height } = grid;
            const offsets = [[[0, 1], [0, 0]], [[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]]];
            const provinces = grid.provinces.map(p => ({ ...p, edges: [] as ProvinceEdgeGraph[] }));
            const accessed = new Uint8Array(colorByPosition.length);
            const concat = (edges: [Point, Point][]): Point[][] => {
                const key = (p: Point) => `${p.x},${p.y}`;
                const used = edges.map(() => false);
                const result: Point[][] = [];
                for (let i = 0; i < edges.length; i++) {
                    if (used[i]) {
                        continue;
                    }
                    used[i] = true;
                    const points = [...edges[i]];
                    let found = true;
                    while (found) {
                        found = false;
                        const h = edges.findIndex((e, k) => !used[k] && key(e[1]) === key(points[0]));
                        if (h !== -1) {
                            used[h] = found = true;
                            points.unshift(edges[h][0]);
                        }
                        const t = edges.findIndex((e, k) => !used[k] && key(e[0]) === key(points[points.length - 1]));
                        if (t !== -1) {
                            used[t] = found = true;
                            points.push(edges[t][1]);
                        }
                    }
                    const kept: Point[] = [];
                    let last = points[0];
                    for (const p of points) {
                        if (kept.length < 2) {
                            kept.push(p);
                        } else if (p.x === last.x || p.y === last.y) {
                            kept[kept.length - 1] = p;
                        } else {
                            last = kept[kept.length - 1];
                            kept.push(p);
                        }
                    }
                    result.push(kept);
                }
                return result;
            };
            for (let start = 0; start < colorByPosition.length; start++) {
                if (accessed[start]) {
                    continue;
                }
                const color = colorByPosition[start];
                const byNeighbour: Record<number, [Point, Point][]> = {};
                const stack = [start];
                while (stack.length > 0) {
                    const index = stack.pop()!;
                    if (accessed[index]) {
                        continue;
                    }
                    const x = index % width;
                    const y = Math.floor(index / width);
                    const adjacent = [
                        x === 0 ? index + width - 1 : index - 1,
                        index - width,
                        x === width - 1 ? index - width + 1 : index + 1,
                        y === height - 1 ? -1 : index + width,
                    ];
                    adjacent.forEach((a, i) => {
                        const neighbour = a < 0 ? -1 : colorByPosition[a];
                        if (neighbour === color) {
                            stack.push(a);
                            return;
                        }
                        const line = offsets[i].map(([dx, dy]) => pt(x + dx, y + dy)) as [Point, Point];
                        (byNeighbour[neighbour] ??= []).push(line);
                    });
                    accessed[index] = 1;
                }
                const province = provinces.find(p => p.color === color)!;
                for (const [neighbour, lines] of Object.entries(byNeighbour)) {
                    const toColor = parseInt(neighbour);
                    let edgeSet = province.edges.find(e => e.toColor === toColor);
                    if (edgeSet === undefined) {
                        province.edges.push(edgeSet = { toColor, path: [] });
                    }
                    edgeSet.path.push(...concat(lines));
                }
            }
            return provinces;
        }

        // Irregular blobs: diagonal bands broken up by a second frequency, so borders are ragged,
        // provinces wrap across the left/right seam, and some touch the top and bottom rows.
        function raggedColors(width: number, height: number): number[][] {
            return Array.from({ length: height }, (_, y) =>
                Array.from({ length: width }, (_, x) =>
                    1 + ((Math.floor((x + y * 2) / 5) + Math.floor((x * 3 + y) / 7)) % 6)));
        }

        for (const [width, height] of [[23, 11], [6, 19], [2, 9], [17, 1]]) {
            it(`matches the reference on a ragged ${width}x${height} grid`, function () {
                const colors = raggedColors(width, height);
                const grid = buildGrid(colors);
                const provinces = fillEdges(grid.provinces, grid.colorByPosition, grid.width, grid.height);
                assert.deepStrictEqual(provinces, fillEdgesReference(colors));
            });
        }
    });
});

describe('worldmap/provincebmp X-crossing validation', function () {
    // Naive reference matching the pre-optimization implementation (per-pixel
    // 4-element array + forEach + filter). The de-closured validateProvince must
    // produce byte-identical warnings for the same input.
    function validateProvinceReference(colorByPosition: Uint32Array, width: number, height: number, file: string): WorldMapWarning[] {
        const warnings: WorldMapWarning[] = [];
        const i: number[] = new Array(4);
        for (let y = 1, y0 = width, index = width; y < height; y++, y0 += width) {
            for (let x = 0; x < width; x++, index++) {
                i[0] = index;
                i[1] = index + (x === width - 1 ? -width : 0) + 1;
                i[2] = i[0] - width;
                i[3] = i[1] - width;
                i.forEach((v, i0) => {
                    i[i0] = colorByPosition[v];
                });
                if (i[0] !== i[1] && i[0] !== i[2] && i[0] !== i[3] && i[1] !== i[2] && i[1] !== i[3] && i[2] !== i[3]) {
                    const colors = i.filter((v, i, a) => a.indexOf(v) === i);
                    warnings.push({
                        source: colors.map(color => ({ color, id: -1, type: 'province' })),
                        relatedFiles: [file],
                        text: localize('worldmap.warnings.xcrossing', 'Map invalid X crossing at: ({0}, {1}).', x, y - 1),
                    });
                }
            }
        }
        return warnings;
    }

    function run(colors: number[][], file = 'map/provinces.bmp'): WorldMapWarning[] {
        const grid = buildGrid(colors);
        const warnings: WorldMapWarning[] = [];
        validateProvince(grid.colorByPosition, grid.width, grid.height, file, warnings);
        return warnings;
    }

    // bg is uniform; A/B over C/D form a single 2x2 block of four distinct colors.
    const bg = 1, A = 10, B = 11, C = 12, D = 13;

    it('matches the reference on an interior X-crossing plus uniform pixels', function () {
        const colors = [
            [bg, A, B, bg],
            [bg, C, D, bg],
            [bg, bg, bg, bg],
            [bg, bg, bg, bg],
        ];
        const grid = buildGrid(colors);
        assert.deepStrictEqual(run(colors), validateProvinceReference(grid.colorByPosition, grid.width, grid.height, 'map/provinces.bmp'));
    });

    it('matches the reference on a wrap-around X-crossing at the last column', function () {
        // Column x=3 wraps to x=0: the four corner colors W/X/Y/Z are all distinct.
        const W = 20, X = 21, Y = 22, Z = 23;
        const colors = [
            [W, bg, bg, X],
            [Y, bg, bg, Z],
        ];
        const grid = buildGrid(colors);
        assert.deepStrictEqual(run(colors), validateProvinceReference(grid.colorByPosition, grid.width, grid.height, 'map/provinces.bmp'));
    });

    it('produces exactly one warning with the expected source and coords for a lone crossing', function () {
        const warnings = run([
            [bg, A, B, bg],
            [bg, C, D, bg],
            [bg, bg, bg, bg],
            [bg, bg, bg, bg],
        ]);
        assert.deepStrictEqual(warnings, [{
            source: [C, D, A, B].map(color => ({ color, id: -1, type: 'province' })),
            relatedFiles: ['map/provinces.bmp'],
            text: 'Map invalid X crossing at: (1, 0).',
        }]);
    });
});
