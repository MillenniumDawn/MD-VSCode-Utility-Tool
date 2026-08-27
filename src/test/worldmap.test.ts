import * as assert from "assert";
import { WorldMap } from "../previewdef/worldmap/worldmap";

function panel(posts: unknown[]): unknown {
	return {
		webview: {
			postMessage: async (message: unknown) => {
				posts.push(message);
				return true;
			},
		},
	};
}

describe("previewdef/worldmap/WorldMap", () => {
	it("slices requested province data before posting it to the webview", async () => {
		const posts: unknown[] = [];
		const worldMap = new WorldMap(panel(posts) as any);
		(worldMap as any).worldMapLoader = {
			getWorldMap: async () => ({ provinces: ["zero", "one", "two"] }),
		};

		await (worldMap as any).onMessage({
			command: "requestprovinces",
			start: 1,
			end: 3,
		});

		assert.deepStrictEqual(posts, [
			{
				command: "provinces",
				data: '["one","two"]',
				start: 1,
				end: 3,
			},
		]);
	});
});
