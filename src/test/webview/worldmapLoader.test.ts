import './setup';
import * as assert from 'assert';
import { WorldMapData } from '../../previewdef/worldmap/definitions';
import { buildWorldMapChangeMessages } from '../../previewdef/worldmap/worldmapchanges';
import { Loader, FEWorldMapClass } from '../../../webviewsrc/worldmap/loader';
import { vscode } from '../../../webviewsrc/util/vscode';

function buildMap() {
    const state1 = { id: 1, provinces: [10, 11] };
    const state2 = { id: 2, provinces: [20] };
    const strategicRegion1 = { id: 1, provinces: [10, 20] };
    const supplyArea1 = { id: 1, states: [1, 2] };
    const railwayA = { provinces: [10, 11], level: 2 };
    const railwayB = { provinces: [11], level: 5 };
    const supplyNode = { province: 20, level: 1 };

    return new FEWorldMapClass({
        states: [undefined, state1, state2],
        statesCount: 3,
        badStatesCount: 0,
        strategicRegions: [undefined, strategicRegion1],
        strategicRegionsCount: 2,
        badStrategicRegionsCount: 0,
        supplyAreas: [undefined, supplyArea1],
        supplyAreasCount: 2,
        badSupplyAreasCount: 0,
        railways: [railwayA, railwayB],
        railwaysCount: 2,
        supplyNodes: [supplyNode],
        supplyNodesCount: 1,
    } as any);
}

describe('webview/worldmap/FEWorldMapClass reverse maps', function () {
    describe('getter correctness', function () {
        it('resolves state by province id', function () {
            const map = buildMap();
            assert.strictEqual(map.getStateByProvinceId(10)?.id, 1);
            assert.strictEqual(map.getStateByProvinceId(11)?.id, 1);
            assert.strictEqual(map.getStateByProvinceId(20)?.id, 2);
            assert.strictEqual(map.getStateByProvinceId(999), undefined);
        });

        it('resolves strategic region by province id', function () {
            const map = buildMap();
            assert.strictEqual(map.getStrategicRegionByProvinceId(10)?.id, 1);
            assert.strictEqual(map.getStrategicRegionByProvinceId(20)?.id, 1);
            assert.strictEqual(map.getStrategicRegionByProvinceId(999), undefined);
        });

        it('resolves supply area by state id', function () {
            const map = buildMap();
            assert.strictEqual(map.getSupplyAreaByStateId(1)?.id, 1);
            assert.strictEqual(map.getSupplyAreaByStateId(2)?.id, 1);
            assert.strictEqual(map.getSupplyAreaByStateId(999), undefined);
        });

        it('takes the max railway level across railways per province', function () {
            const map = buildMap();
            assert.strictEqual(map.getRailwayLevelByProvinceId(10), 2);
            assert.strictEqual(map.getRailwayLevelByProvinceId(11), 5);
            assert.strictEqual(map.getRailwayLevelByProvinceId(20), undefined);
        });

        it('resolves supply node by province id', function () {
            const map = buildMap();
            assert.strictEqual(map.getSupplyNodeByProvinceId(20)?.province, 20);
            assert.strictEqual(map.getSupplyNodeByProvinceId(10), undefined);
        });

        it('builds the forward maps used by the renderer', function () {
            const map = buildMap();
            assert.deepStrictEqual(map.getProvinceToStateMap(), { 10: 1, 11: 1, 20: 2 });
            assert.deepStrictEqual(map.getProvinceToStrategicRegionMap(), { 10: 1, 20: 1 });
            assert.deepStrictEqual(map.getStateToSupplyAreaMap(), { 1: 1, 2: 1 });
        });
    });

    describe('memoization', function () {
        it('returns the same map instance on repeated calls', function () {
            const map = buildMap();
            assert.strictEqual(map.getProvinceToStateMap(), map.getProvinceToStateMap());
            assert.strictEqual(map.getProvinceToStrategicRegionMap(), map.getProvinceToStrategicRegionMap());
            assert.strictEqual(map.getStateToSupplyAreaMap(), map.getStateToSupplyAreaMap());
        });

        it('scopes memoized maps strictly per instance', function () {
            const a = buildMap();
            const b = buildMap();
            assert.notStrictEqual(a.getProvinceToStateMap(), b.getProvinceToStateMap());
            assert.notStrictEqual(a.getProvinceToStrategicRegionMap(), b.getProvinceToStrategicRegionMap());
            assert.notStrictEqual(a.getStateToSupplyAreaMap(), b.getStateToSupplyAreaMap());
        });
    });
});

describe('webview/worldmap/Loader protocol', function () {
    it('applies requested chunks and later deltas after a map summary', function () {
        const posted: unknown[] = [];
        const originalPostMessage = vscode.postMessage;
        const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (callback): number => {
            callback(0);
            return 0;
        };
        vscode.postMessage = <T>(message: T): void => {
            posted.push(message);
        };
        const loader = new Loader();
        posted.length = 0;

        const summary: WorldMapData = {
            width: 1,
            height: 1,
            provinces: [],
            states: [],
            countries: [],
            strategicRegions: [],
            supplyAreas: [],
            railways: [],
            supplyNodes: [],
            provincesCount: 0,
            statesCount: 0,
            countriesCount: 1,
            strategicRegionsCount: 0,
            supplyAreasCount: 0,
            railwaysCount: 0,
            supplyNodesCount: 0,
            badProvincesCount: 0,
            badStatesCount: 0,
            badStrategicRegionsCount: 0,
            badSupplyAreasCount: 0,
            continents: [],
            terrains: [],
            resources: [],
            rivers: [],
            warnings: [],
        };
        const send = (data: unknown): void => {
            window.dispatchEvent(new window.MessageEvent('message', { data }));
        };

        try {
            send({ command: 'provincemapsummary', data: summary });
            assert.deepStrictEqual(posted, [
                { command: 'requestcountries', start: 0, end: 1 },
            ]);

            send({
                command: 'countries',
                data: JSON.stringify([{ tag: 'AAA', color: 1 }]),
                start: 0,
                end: 1,
            });
            assert.strictEqual(loader.worldMap.countries[0].tag, 'AAA');

            const updated: WorldMapData = {
                ...summary,
                countries: [{ tag: 'BBB', color: 2 }],
                warnings: [{ text: 'updated', source: [], relatedFiles: [] }],
            };
            const messages = buildWorldMapChangeMessages(
                { ...summary, countries: [{ tag: 'AAA', color: 1 }] },
                updated,
            );
            assert.deepStrictEqual(
                messages?.map((message) => message.command),
                ['warnings', 'countries'],
            );
            for (const message of messages ?? []) {
                send(message);
            }

            assert.strictEqual(loader.worldMap.warnings[0].text, 'updated');
            assert.strictEqual(loader.worldMap.countries[0].tag, 'BBB');
        } finally {
            loader.dispose();
            vscode.postMessage = originalPostMessage;
            globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        }
    });
});
