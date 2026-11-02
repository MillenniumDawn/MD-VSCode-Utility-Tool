import * as assert from "assert";
import { WorldMap } from "../../../../previewdef/worldmap/worldmap";
import { WorldMapData } from "../../../../previewdef/worldmap/definitions";
import { handOver } from "../../host";

function emptyMap(width: number): WorldMapData {
	return {
		width,
		height: 2,
		provinces: [],
		states: [],
		countries: [],
		strategicRegions: [],
		supplyAreas: [],
		railways: [],
		supplyNodes: [],
		provincesCount: 0,
		statesCount: 0,
		countriesCount: 0,
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
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
	reject: (e: unknown) => void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Stands in for WorldMapLoader. Each summary load takes results[count] once its gate resolves;
// getWorldMap serves the loaded map the loader would have cached, without loading again.
function summaryLoader(results: WorldMapData[], gates: (Deferred | undefined)[]) {
	const state = { loads: 0, reads: 0 };
	const loader = {
		load: async () => {
			const call = state.loads++;
			const gate = gates[call];
			if (gate) {
				await gate.promise;
			}
			return {
				result: results[call],
				dependencies: ["map/default.map"],
				warnings: [],
			};
		},
		getWorldMap: async () => {
			state.reads++;
			return results[state.loads - 1] ?? results[0];
		},
		shallowForceReload: () => undefined,
		onProgress: () => ({ dispose() {} }),
	};
	return { state, loader: loader as unknown as WorldMap["worldMapLoader"] };
}

function itemLoader(result: WorldMapData, gate?: Deferred) {
	const state = { reads: 0 };
	const loader = {
		getWorldMap: async () => {
			state.reads++;
			if (gate) {
				await gate.promise;
			}
			return result;
		},
		shallowForceReload: () => undefined,
		onProgress: () => ({ dispose() {} }),
	};
	return { state, loader: loader as unknown as WorldMap["worldMapLoader"] };
}

function webviewPanel(posts: unknown[], postGate?: Deferred) {
	return {
		webview: {
			postMessage: async (message: unknown) => {
				posts.push(message);
				if (postGate) {
					await postGate.promise;
				}
				return true;
			},
		},
		visible: true,
	};
}

function quietErrors(): { messages: unknown[][]; restore(): void } {
	const messages: unknown[][] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		messages.push(args);
	};
	return {
		messages,
		restore: () => {
			console.error = original;
		},
	};
}

function hide(wm: WorldMap): void {
	(wm.panel as any).visible = false;
	(wm as any).onViewStateChanged();
}

function show(wm: WorldMap): void {
	(wm.panel as any).visible = true;
	(wm as any).onViewStateChanged();
}

describe("previewdef/worldmap/WorldMap releaseMemory", () => {
	beforeEach(() => {
		handOver({
			Disposable: {
				from: () => ({ dispose: () => undefined }),
			},
			window: {
				createOutputChannel: () => ({
					appendLine: () => undefined,
					dispose: () => undefined,
				}),
			},
		} as any);
	});

	it("a load settling after a deferred hide answers the webview, then releases the loader", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const mapA = emptyMap(11);
		const gate = deferred();
		const { loader } = summaryLoader([mapA], [gate]);
		(wm as any).worldMapLoader = loader;

		const settled = (wm as any).onMessage({ command: "loaded", force: true });
		hide(wm);

		assert.strictEqual((wm as any).cachedWorldMap, undefined);
		assert.strictEqual((wm as any).worldMapLoader, loader, "the loader stays while it is owed a response");
		assert.deepStrictEqual(posts, []);

		gate.resolve();
		await settled;

		assert.strictEqual((posts[0] as { command: string }).command, "provincemapsummary");
		assert.strictEqual((posts[0] as { data: WorldMapData }).data.width, 11);
		assert.strictEqual((wm as any).cachedWorldMap, undefined, "the settled load keeps no cache");
		assert.notStrictEqual((wm as any).worldMapLoader, loader, "the release came after the response");
	});

	it("a hide drops the cached map at once and the loader when nothing still owes a response", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const { loader } = summaryLoader([emptyMap(5)], []);
		(wm as any).worldMapLoader = loader;
		await (wm as any).onMessage({ command: "loaded", force: true });
		assert.ok((wm as any).cachedWorldMap);

		hide(wm);

		assert.strictEqual((wm as any).cachedWorldMap, undefined);
		assert.notStrictEqual((wm as any).worldMapLoader, loader);
	});

	it("a visible reload after a release loads on the fresh loader and caches its result again", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const first = emptyMap(4);
		const second = emptyMap(7);
		const secondGate = deferred();
		(wm as any).worldMapLoader = summaryLoader([first], []).loader;
		await (wm as any).onMessage({ command: "loaded", force: true });

		hide(wm);
		assert.strictEqual((wm as any).cachedWorldMap, undefined);

		const fresh = summaryLoader([second], [secondGate]);
		(wm as any).worldMapLoader = fresh.loader;
		show(wm);
		const reload = (wm as any).onMessage({ command: "loaded", force: true });
		secondGate.resolve();
		await reload;

		assert.strictEqual((wm as any).cachedWorldMap, second);
		assert.strictEqual((wm as any).worldMapLoader, fresh.loader);
		assert.deepStrictEqual(
			posts.map((p) => (p as { command: string }).command),
			["provincemapsummary", "provincemapsummary"],
		);
		assert.strictEqual((posts[1] as { data: WorldMapData }).data.width, 7);
	});

	it("a map-item response posting after a hide finishes before the loader is released", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const mapA = emptyMap(3);
		(mapA as any).provinces = ["p0"];
		const gate = deferred();
		const { loader } = itemLoader(mapA, gate);
		(wm as any).worldMapLoader = loader;

		const settled = (wm as any).onMessage({
			command: "requestprovinces",
			start: 0,
			end: 1,
		});
		hide(wm);

		assert.strictEqual((wm as any).worldMapLoader, loader, "the loader stays while its slice is owed");

		gate.resolve();
		await settled;

		assert.deepStrictEqual(posts, [
			{ command: "provinces", data: '["p0"]', start: 0, end: 1 },
		]);
		assert.strictEqual((wm as any).cachedWorldMap, undefined);
		assert.notStrictEqual((wm as any).worldMapLoader, loader, "the release happened after the response");

		const next = emptyMap(9);
		(next as any).provinces = ["q0", "q1"];
		(wm as any).worldMapLoader = itemLoader(next).loader;
		await (wm as any).onMessage({
			command: "requestprovinces",
			start: 0,
			end: 2,
		});

		assert.deepStrictEqual(
			posts[posts.length - 1],
			{ command: "provinces", data: '["q0","q1"]', start: 0, end: 2 },
			"the next request is served from the loader now in place",
		);
	});

	it("an item request that starts hidden loads into the loader in place and releases it after its response", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		hide(wm);

		const mapA = emptyMap(30);
		(mapA as any).provinces = ["p0"];
		const { loader } = itemLoader(mapA);
		(wm as any).worldMapLoader = loader;

		await (wm as any).onMessage({
			command: "requestprovinces",
			start: 0,
			end: 1,
		});

		assert.deepStrictEqual(posts, [
			{ command: "provinces", data: '["p0"]', start: 0, end: 1 },
		]);
		assert.strictEqual((wm as any).cachedWorldMap, undefined);
		assert.notStrictEqual((wm as any).worldMapLoader, loader, "the loader it filled is released too");
	});

	it("showing again before the load settles cancels the release and the loader is reused", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const mapA = emptyMap(12);
		(mapA as any).provinces = ["p0"];
		const gate = deferred();
		const { state, loader } = summaryLoader([mapA], [gate]);
		(wm as any).worldMapLoader = loader;

		const settled = (wm as any).onMessage({ command: "loaded", force: true });
		hide(wm);
		show(wm);

		gate.resolve();
		await settled;

		assert.strictEqual((posts[0] as { command: string }).command, "provincemapsummary");
		assert.strictEqual((wm as any).cachedWorldMap, mapA, "the visible settle caches again");
		assert.strictEqual((wm as any).worldMapLoader, loader, "no release ran behind the shown panel");

		await (wm as any).onMessage({
			command: "requestprovinces",
			start: 0,
			end: 1,
		});
		assert.deepStrictEqual(posts[posts.length - 1], {
			command: "provinces",
			data: '["p0"]',
			start: 0,
			end: 1,
		});
		assert.strictEqual((wm as any).worldMapLoader, loader);
		assert.strictEqual(state.loads, 1, "the retained loader's result is reused without a reload");
	});

	it("an older request publishes nothing, and the release waits until both responses are done", async () => {
		const posts: unknown[] = [];
		const olderMap = emptyMap(1);
		const newerMap = emptyMap(2);
		const olderGate = deferred();
		const newerGate = deferred();
		const wm = new WorldMap(webviewPanel(posts) as any);
		const { loader } = summaryLoader([olderMap, newerMap], [olderGate, newerGate]);
		(wm as any).worldMapLoader = loader;

		const older = (wm as any).onMessage({ command: "loaded", force: false });
		const newer = (wm as any).onMessage({ command: "loaded", force: true });
		hide(wm);

		newerGate.resolve();
		await newer;

		assert.strictEqual(
			posts.filter((p) => (p as { command: string }).command === "provincemapsummary").length,
			1,
			"only the newer request publishes",
		);
		assert.strictEqual((posts[0] as { data: WorldMapData }).data.width, 2);
		assert.strictEqual((wm as any).cachedWorldMap, newerMap);
		assert.strictEqual((wm as any).worldMapLoader, loader, "no release while the older request is open");

		olderGate.resolve();
		await older;

		assert.strictEqual(
			posts.filter((p) => (p as { command: string }).command === "provincemapsummary").length,
			1,
			"the superseded request publishes nothing",
		);
		assert.strictEqual((wm as any).cachedWorldMap, undefined, "released after both settled");
		assert.notStrictEqual((wm as any).worldMapLoader, loader);
	});

	it("a failed load posts one error and caches nothing", async () => {
		const posts: unknown[] = [];
		const quiet = quietErrors();
		try {
			const wm = new WorldMap(webviewPanel(posts) as any);
			const failure = new Error("boom");
			(wm as any).worldMapLoader = {
				load: async () => {
					throw failure;
				},
				shallowForceReload: () => undefined,
				onProgress: () => ({ dispose() {} }),
			};

			await (wm as any).onMessage({ command: "loaded", force: true });

			assert.deepStrictEqual(
				posts,
				[{ command: "error", data: "Failed to load world map: Error: boom." }],
			);
			assert.strictEqual((wm as any).cachedWorldMap, undefined);
			assert.deepStrictEqual(quiet.messages, [[failure]]);
		} finally {
			quiet.restore();
		}
	});

	it("a superseded failure stays quiet while the newer request still publishes", async () => {
		const posts: unknown[] = [];
		const quiet = quietErrors();
		try {
			const olderFailure = new Error("older failed");
			const newerMap = emptyMap(6);
			const olderGate = deferred();
			const newerGate = deferred();
			const wm = new WorldMap(webviewPanel(posts) as any);
			let loadCount = 0;
			(wm as any).worldMapLoader = {
				load: async () => {
					if (loadCount++ === 0) {
						await olderGate.promise;
						throw olderFailure;
					}
					await newerGate.promise;
					return {
						result: newerMap,
						dependencies: ["map/default.map"],
						warnings: [],
					};
				},
				shallowForceReload: () => undefined,
				onProgress: () => ({ dispose() {} }),
			};

			const older = (wm as any).onMessage({ command: "loaded", force: false });
			const newer = (wm as any).onMessage({ command: "loaded", force: true });

			olderGate.resolve();
			await older;
			newerGate.resolve();
			await newer;

			assert.deepStrictEqual(
				posts,
				[
					{
						command: "provincemapsummary",
						data: {
							...newerMap,
							provinces: [],
							states: [],
							countries: [],
							strategicRegions: [],
							supplyAreas: [],
							railways: [],
							supplyNodes: [],
						},
					},
				],
			);
			assert.strictEqual((wm as any).cachedWorldMap, newerMap);
			assert.deepStrictEqual(quiet.messages, [[olderFailure]]);
		} finally {
			quiet.restore();
		}
	});

	it("disposing drops the cached map and the loader at once", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const { loader } = summaryLoader([emptyMap(5)], []);
		(wm as any).worldMapLoader = loader;
		await (wm as any).onMessage({ command: "loaded", force: true });
		assert.ok((wm as any).cachedWorldMap);

		(wm as any).dispose();

		assert.strictEqual((wm as any).panel, undefined);
		assert.strictEqual((wm as any).cachedWorldMap, undefined);
		assert.notStrictEqual((wm as any).worldMapLoader, loader);
	});

	it("a load settling after disposal caches nothing and its loader is released once it ends", async () => {
		const posts: unknown[] = [];
		const wm = new WorldMap(webviewPanel(posts) as any);
		const mapA = emptyMap(8);
		const gate = deferred();
		const { loader } = summaryLoader([mapA], [gate]);
		(wm as any).worldMapLoader = loader;

		const settled = (wm as any).onMessage({ command: "loaded", force: true });
		(wm as any).dispose();

		assert.strictEqual((wm as any).worldMapLoader, loader, "the loader stays while its request is open");

		gate.resolve();
		await settled;

		assert.deepStrictEqual(posts, [], "a disposed panel is answered with nothing");
		assert.strictEqual((wm as any).cachedWorldMap, undefined, "a disposed settle caches nothing");
		assert.notStrictEqual((wm as any).worldMapLoader, loader, "the loader is released after the settle");
	});

	it("the release waits for an in-flight response post before dropping the loader", async () => {
		const posts: unknown[] = [];
		const postGate = deferred();
		const wm = new WorldMap(webviewPanel(posts, postGate) as any);
		const loadGate = deferred();
		const { loader } = summaryLoader([emptyMap(6)], [loadGate]);
		(wm as any).worldMapLoader = loader;

		const settled = (wm as any).onMessage({ command: "loaded", force: true });
		hide(wm);

		loadGate.resolve();
		await new Promise((resolve) => setImmediate(resolve));

		assert.strictEqual((posts[0] as { command: string }).command, "provincemapsummary");
		assert.strictEqual((posts[0] as { data: WorldMapData }).data.width, 6);
		assert.strictEqual((wm as any).worldMapLoader, loader, "the loader outlives its pending post");

		postGate.resolve();
		await settled;

		assert.notStrictEqual((wm as any).worldMapLoader, loader, "released once the post finished");
		assert.strictEqual((wm as any).cachedWorldMap, undefined);
	});

	it("answering every item command from its own field of the loaded map", async () => {
		const map = emptyMap(1);
		(map as any).provinces = ["province"];
		(map as any).states = ["state"];
		(map as any).countries = ["country"];
		(map as any).strategicRegions = ["strategicregion"];
		(map as any).supplyAreas = ["supplyarea"];
		(map as any).railways = ["railway"];
		(map as any).supplyNodes = ["supplynode"];
		const cases = [
			["requestprovinces", "province", "provinces"],
			["requeststates", "state", "states"],
			["requestcountries", "country", "countries"],
			["requeststrategicregions", "strategicregion", "strategicregions"],
			["requestsupplyareas", "supplyarea", "supplyareas"],
			["requestrailways", "railway", "railways"],
			["requestsupplynodes", "supplynode", "supplynodes"],
		] as const;

		for (const [command, value, posted] of cases) {
			const posts: unknown[] = [];
			const wm = new WorldMap(webviewPanel(posts) as any);
			const { loader } = itemLoader(map);
			(wm as any).worldMapLoader = loader;

			await (wm as any).onMessage({ command, start: 0, end: 1 });

			assert.deepStrictEqual(posts, [
				{ command: posted, data: JSON.stringify([value]), start: 0, end: 1 },
			]);
			assert.strictEqual((wm as any).worldMapLoader, loader, "nothing releases behind a visible panel");
		}
	});
});