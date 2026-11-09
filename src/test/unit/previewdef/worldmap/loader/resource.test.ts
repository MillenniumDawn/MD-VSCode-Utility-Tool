import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../../util/fileloader";
import * as gfxindex from "../../../../../util/gfxindex";
import * as imagecache from "../../../../../util/image/imagecache";
import * as vsccommon from "../../../../../util/vsccommon";
import { refreshFeatureFlags } from "../../../../../util/featureflags";
import { ResourceDefinitionLoader } from "../../../../../previewdef/worldmap/loader/resource";
import { LoaderSession } from "../../../../../util/loader/loader";
import { handOver } from "../../../host";
import { PNG } from "pngjs";

const fallbackGfx = "interface/general_stuff.gfx";
const indexedGfxBase = "interface/mod_resources";
let suffix = 0;
// Unique file names per configure() call for everything the test owns: the fileloader's 500 ms
// stat memo survives a reset of the mock clock, so a path a previous test left memoized must not
// be re-keyed by another. The fallback .gfx keeps its production name.
let indexedGfx: string;
let texture1: string;
let texture2: string;
let texture3: string;
// Two distinct 2x1 frame strips, so a re-resolved sprite yields a different data URI.
function strip(r1: number, r2: number): Buffer {
	const png = new PNG({ width: 2, height: 1 });
	png.data[0] = r1;
	png.data[3] = 255;
	png.data[4] = r2;
	png.data[7] = 255;
	return PNG.sync.write(png);
}
const strips: Record<string, Buffer> = {
	a: strip(255, 200),
	b: strip(10, 30),
	c: strip(77, 99),
};

function gfxText(textureFile: string): string {
	return [
		"spriteTypes = { spriteType = {",
		'\tname = "GFX_resources_strip"',
		`\ttexturefile = "${textureFile}"`,
		"\tnoOfFrames = 2",
		"} }",
	].join("\n");
}

function uri(filePath: string): any {
	return {
		scheme: "file",
		path: filePath,
		fsPath: filePath,
		fragment: "",
		toString: () => `file://${filePath}`,
		with: (change: { fragment?: string }) => ({
			...uri(filePath),
			fragment: change.fragment ?? "",
		}),
	};
}

// The sprite's expiry token stats the texture through its real file path, which arrives here
// re-parsed from `file:///mod/...` by the stub Uri.parse.
function relativeOf(file: any): string {
	return String(file.path).replace(/^\/mod\//, "");
}

let versions: Record<string, number>;
// texturefile a .gfx currently points at, and which strip each texture decodes to.
let gfxTextureFile: Record<string, string>;
let textures: Record<string, string>;
let indexedContainer: string | undefined;
let counts: Record<string, number>;

function configure(gfxIndex: boolean): void {
	suffix++;
	indexedGfx = `${indexedGfxBase}${suffix}.gfx`;
	texture1 = `gfx/interface/resources_strip${suffix}.png`;
	texture2 = `gfx/interface/resources_strip2_${suffix}.png`;
	texture3 = `gfx/interface/resources_strip3_${suffix}.png`;
	versions = {
		[fallbackGfx]: 1,
		[indexedGfx]: 1,
		[texture1]: 1,
		[texture2]: 1,
		[texture3]: 1,
	};
	gfxTextureFile = { [fallbackGfx]: texture1, [indexedGfx]: texture2 };
	textures = { [texture1]: "a", [texture2]: "b", [texture3]: "c" };
	indexedContainer = undefined;
	counts = {};

	handOver({
		Uri: {
			parse: (value: string) => uri(value.replace("file://", "")),
			joinPath: (base: any, ...parts: string[]) =>
				uri([base.path, ...parts].join("/")),
		},
		FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
		window: {
			createOutputChannel: () => ({
				appendLine: () => undefined,
				show: () => undefined,
				dispose: () => undefined,
			}),
		},
		workspace: {
			workspaceFolders: [{ uri: uri("/mod") }],
			textDocuments: [],
			getConfiguration: () => ({
				gfxIndex,
				loadDlcContents: false,
				imageDecodeWorkers: 1,
			}),
			fs: {
				stat: async (file: any) => {
					const relativePath = relativeOf(file);
					if (relativePath in versions) {
						return {
							type: 1,
							mtime: versions[relativePath],
							ctime: 0,
							size: 1,
						};
					}
					throw new Error(`missing ${relativePath}`);
				},
			},
		},
	});
	refreshFeatureFlags();

	mock.method(
		fileloader,
		"listFilesFromModOrHOI4",
		(async (folder: string) => {
			if (folder === "common/resources") {
				return ["00_resources.txt"];
			}
			throw new Error(`unexpected list ${folder}`);
		}) as never,
	);
	mock.method(
		fileloader,
		"readFileFromModOrHOI4AsJson",
		(async () => ({
			resources: {
				_map: { oil: { _key: "oil", _value: { icon_frame: 1 } } },
			},
		})) as never,
	);
	mock.method(
		fileloader,
		"readFileFromModOrHOI4",
		(async (relativePath: string) => {
			counts[relativePath] = (counts[relativePath] ?? 0) + 1;
			if (relativePath === fallbackGfx || relativePath === indexedGfx) {
				return [
					Buffer.from(gfxText(gfxTextureFile[relativePath]!)),
					uri(`/mod/${relativePath}`),
				];
			}
			if (relativePath in textures) {
				return [strips[textures[relativePath]!]!, uri(`/mod/${relativePath}`)];
			}
			throw new Error(`unexpected read ${relativePath}`);
		}) as never,
	);
	mock.method(
		fileloader,
		"hoiFileExpiryToken",
		(async (relativePath: string) =>
			`${relativePath}@${versions[relativePath] ?? 0}`) as never,
	);
	mock.method(
		fileloader,
		"hoiFilesExpiryToken",
		(async (relativePaths: string[]) =>
			relativePaths
				.map((relativePath) => `${relativePath}@${versions[relativePath] ?? 0}`)
				.join("|")) as never,
	);
	mock.method(
		gfxindex,
		"getGfxContainerFile",
		(async () => indexedContainer) as never,
	);
	mock.method(
		vsccommon,
		"getLastModifiedAsync",
		(async (file: any) => versions[relativeOf(file)] ?? 0) as never,
	);
}

function bump(file: string, by = 1): void {
	versions[file]! += by;
	mock.timers.tick(1001);
}

// The fileloader's 500 ms stat memo outlives a phase, so every version flip is followed by a
// tick that flushes it; the fake Date starts each test at the real clock's current time.
describe("previewdef/worldmap/loader ResourceDefinitionLoader resource icons", () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ["Date"] });
	});

	afterEach(async () => {
		mock.restoreAll();
		imagecache._clearImageCachesForTest();
		await fileloader.clearDlcZipCache();
		mock.timers.reset();
		handOver({
			workspace: {
				textDocuments: [],
				getConfiguration: () => ({}),
			},
		});
		refreshFeatureFlags();
	});

	it("rebuilds the icons behind the fallback GFX on a non-forced session and reports its files", async () => {
		configure(false);
		const loader = new ResourceDefinitionLoader();
		const first = await loader.load(new LoaderSession(false));
		const firstUri = first.result[0]?.imageUri;
		assert.ok(firstUri?.startsWith("data:image/png;base64,"), firstUri);
		assert.deepStrictEqual(first.dependencies, [
			"common/resources/*",
			fallbackGfx,
			texture1,
		]);

		// The fallback .gfx now cuts its frames from another texture: an ordinary, non-forced
		// session must rebuild the resource image URIs, not wait for a forced Refresh.
		gfxTextureFile[fallbackGfx] = texture2;
		bump(fallbackGfx);
		const second = await loader.load(new LoaderSession(false));
		const secondUri = second.result[0]?.imageUri;
		assert.ok(secondUri?.startsWith("data:image/png;base64,"), secondUri);
		assert.notStrictEqual(secondUri, firstUri);
		assert.deepStrictEqual(second.dependencies, [
			"common/resources/*",
			fallbackGfx,
			texture2,
		]);

		// An unchanged session stays cached and resolves nothing new.
		const readsBefore = { ...counts };
		const third = await loader.load(new LoaderSession(false));
		assert.deepStrictEqual(third.result, second.result);
		assert.deepStrictEqual(third.dependencies, second.dependencies);
		assert.deepStrictEqual(counts, readsBefore);
	});

	it("rebuilds the icons when the sprite's texture itself changed", async () => {
		configure(false);
		const loader = new ResourceDefinitionLoader();
		const first = await loader.load(new LoaderSession(false));
		const firstUri = first.result[0]?.imageUri;
		assert.ok(firstUri?.startsWith("data:image/png;base64,"), firstUri);

		textures[texture1] = "c";
		bump(texture1);
		const second = await loader.load(new LoaderSession(false));
		assert.notStrictEqual(second.result[0]?.imageUri, firstUri);
		// The dependency list names the texture, so the world map hears about such an edit.
		assert.deepStrictEqual(second.dependencies, [
			"common/resources/*",
			fallbackGfx,
			texture1,
		]);
	});

	it("retries an edit that arrives after the icons were read", async () => {
		configure(false);
		const getSprite = imagecache.getSpriteByGfxName;
		let edited = false;
		mock.method(imagecache, "getSpriteByGfxName", async (...args: Parameters<typeof getSprite>) => {
			const sprite = await getSprite(...args);
			if (!edited) {
				edited = true;
				textures[texture1] = "c";
				bump(texture1);
			}
			return sprite;
		});
		const loader = new ResourceDefinitionLoader();
		const first = await loader.load(new LoaderSession(false));
		const second = await loader.load(new LoaderSession(false));
		assert.notStrictEqual(second.result[0]?.imageUri, first.result[0]?.imageUri);
	});

	it("watches the indexed container instead of the fallback .gfx", async () => {
		configure(true);
		indexedContainer = indexedGfx;
		const loader = new ResourceDefinitionLoader();
		const first = await loader.load(new LoaderSession(false));
		const firstUri = first.result[0]?.imageUri;
		assert.ok(firstUri?.startsWith("data:image/png;base64,"), firstUri);
		assert.strictEqual(first.result[0]?.iconFrame, 1);
		// The resolvable index is authoritative: its container is the dependency, the untouched
		// fallback .gfx is not.
		assert.deepStrictEqual(first.dependencies, [
			"common/resources/*",
			indexedGfx,
			texture2,
		]);

		// Moving `GFX_resources_strip` around in the fallback .gfx cannot re-source the sprite
		// while the index resolves it elsewhere, so the cached result survives the edit.
		gfxTextureFile[fallbackGfx] = texture3;
		bump(fallbackGfx);
		const afterFallbackBump = await loader.load(new LoaderSession(false));
		assert.deepStrictEqual(afterFallbackBump.result, first.result);
		assert.deepStrictEqual(afterFallbackBump.dependencies, first.dependencies);

		// The indexed container itself moved the sprite to another texture: the URIs must be
		// rebuilt on the same non-forced session.
		gfxTextureFile[indexedGfx] = texture3;
		bump(indexedGfx);
		const second = await loader.load(new LoaderSession(false));
		assert.notStrictEqual(second.result[0]?.imageUri, firstUri);
		assert.deepStrictEqual(second.dependencies, [
			"common/resources/*",
			indexedGfx,
			texture3,
		]);
	});

	it("resolves the sprite to nothing when the index dropped the sprite", async () => {
		configure(true);
		indexedContainer = indexedGfx;
		const loader = new ResourceDefinitionLoader();
		const first = await loader.load(new LoaderSession(false));
		assert.ok(first.result[0]?.imageUri?.startsWith("data:image/png;base64,"));

		indexedContainer = undefined;
		mock.timers.tick(1001);
		const second = await loader.load(new LoaderSession(false));
		assert.strictEqual(second.result[0]?.imageUri, "");
		assert.deepStrictEqual(second.dependencies, ["common/resources/*"]);
	});
});
