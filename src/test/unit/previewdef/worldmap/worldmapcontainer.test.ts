import * as assert from "assert";
import { WorldMapContainer } from "../../../../previewdef/worldmap/worldmapcontainer";
import { WorldMap } from "../../../../previewdef/worldmap/worldmap";
import { WorldMapData } from "../../../../previewdef/worldmap/definitions";
import { handOver } from "../../host";

function supplyAreaMap(count: number): WorldMapData {
	const map = {
		width: 4,
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
	map.supplyAreasCount = count;
	if (count > 0) {
		map.supplyAreas = ["supplyarea" as unknown as never];
	}
	return map;
}

function webviewPanel(posts: unknown[]): unknown {
	return {
		webview: {
			postMessage: async (message: unknown) => {
				posts.push(message);
				return true;
			},
		},
		visible: true,
	};
}

// A loader stand-in whose loads re-read the configuration the way the real one does.
function summaryLoader(configuration: Record<string, unknown>) {
	const loader = {
		load: async () => ({
			result: supplyAreaMap(configuration.enableSupplyArea ? 2 : 0),
			dependencies: ["map/default.map"],
			warnings: [],
		}),
		getWorldMap: async () => supplyAreaMap(configuration.enableSupplyArea ? 2 : 0),
		shallowForceReload: () => undefined,
		isShallowReloadPending: () => false,
		onProgress: () => ({ dispose() {} }),
	};
	return loader as unknown as WorldMap["worldMapLoader"];
}

// microtasks through one macro task: the container's handler chain must have settled.
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

// Issue #739: the configuration listener lives on the container, not on a PreviewBase, because
// the world map is its own panel.
describe("previewdef/worldmap/WorldMapContainer configuration listener", () => {
	const configurationChangeHandlers: ((e: { affectsConfiguration(section: string): boolean }) => void)[] = [];
	let disposed: number = 0;
	let configuration: Record<string, unknown>;

	beforeEach(() => {
		configurationChangeHandlers.length = 0;
		disposed = 0;
		configuration = { enableSupplyArea: false };
		handOver({
			Disposable: {
				from: (...disposables: { dispose(): void }[]) => ({
					dispose: () => {
						for (const d of disposables) {
							d.dispose();
						}
					},
				}),
			},
			commands: {
				registerCommand: () => ({ dispose: () => undefined }),
			},
			window: {
				registerWebviewPanelSerializer: () => ({ dispose: () => undefined }),
			},
			workspace: {
				getConfiguration: () => configuration,
				onDidCloseTextDocument: () => ({ dispose: () => undefined }),
				onDidChangeTextDocument: () => ({ dispose: () => undefined }),
					onDidChangeConfiguration: (
						handler: (e: { affectsConfiguration(section: string): boolean }) => void,
					) => {
						configurationChangeHandlers.push(handler);
						return {
							dispose: () => {
								disposed++;
							},
						};
					},
			},
		} as any);
	});

	function openMapPanel(posts: unknown[]): WorldMap {
		const worldMap = new WorldMap(webviewPanel(posts) as any);
		(worldMap as any).worldMapLoader = summaryLoader(configuration);
		return worldMap;
	}

	it("a supply-area setting change on an open panel re-reads the setting and pushes the new mode", async () => {
		const posts: unknown[] = [];
		const container = new WorldMapContainer();
		container.register();
		(container as any).worldMap = openMapPanel(posts);

		configuration.enableSupplyArea = true;
		configurationChangeHandlers[0]!({
			affectsConfiguration: (section: string) =>
				section === "mdHoi4Utilities.enableSupplyArea",
		});
		await settle();

		assert.deepStrictEqual(
			posts.map((p) => (p as { command: string }).command),
			["enablesupplyarea", "provincemapsummary"],
			"the flag reached the page, then the reloaded data",
		);
		const flag = posts[0] as { command: string; data: boolean };
		assert.strictEqual(flag.data, true);
		const summary = posts[1] as { command: string; data: WorldMapData };
		assert.strictEqual(summary.data.supplyAreasCount, 2);
	});

	it("a change to another setting leaves the panel alone", async () => {
		const posts: unknown[] = [];
		const container = new WorldMapContainer();
		container.register();
		(container as any).worldMap = openMapPanel(posts);

		configuration.enableSupplyArea = true;
		configurationChangeHandlers[0]!({
			affectsConfiguration: (section: string) =>
				section === "mdHoi4Utilities.modFile",
		});
		await settle();

		assert.deepStrictEqual(posts, []);
	});

	it("a supply-area setting change with no open panel does nothing", async () => {
		const container = new WorldMapContainer();
		container.register();

		assert.doesNotThrow(() => {
			configurationChangeHandlers[0]!({
				affectsConfiguration: (section: string) =>
					section === "mdHoi4Utilities.enableSupplyArea",
			});
		});
		await settle();
	});

	it("the configuration listener is disposed with the container", () => {
		const container = new WorldMapContainer();
		const registration = container.register();

		assert.strictEqual(configurationChangeHandlers.length, 1);
		registration.dispose();
		assert.strictEqual(disposed, 1, "the container's registration disposed the listener");
	});
});
