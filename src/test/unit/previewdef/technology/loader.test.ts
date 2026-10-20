import * as assert from "assert";
import * as fileloader from "../../../../util/fileloader";
import { invalidateFileDiscoveryCache } from "../../../../util/fileloader";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { equipmentDependencies } from "../../../../previewdef/technology/loader";
import { LoaderSession } from "../../../../util/loader/loader";
import { matchPathEnd } from "../../../../util/nodecommon";
import { handOver, fresh } from "../../host";

describe("previewdef/technology equipment dependencies", () => {
	const equipmentFiles = [
		"common/units/equipment/infantry.txt",
		"common/units/equipment/tank/armor.txt",
	];
	const dependencies = equipmentDependencies(equipmentFiles);

	function matches(path: string): boolean {
		return dependencies.some((dependency) =>
			matchPathEnd(path, dependency.split("/")),
		);
	}

	it("matches created and removed root and one-level nested file paths", () => {
		for (const operation of ["create", "delete"]) {
			for (const path of [
				"common/units/equipment/new.txt",
				"common/units/equipment/air/new.txt",
			]) {
				assert.strictEqual(matches(path), true, `${operation} of ${path} should refresh the preview`);
			}
		}
	});

	it("keeps the loaded file dependencies for edits and expiry", () => {
		for (const file of equipmentFiles) {
			assert.ok(dependencies.includes(file), `${file} remains a loader dependency`);
		}
		assert.deepStrictEqual(equipmentFiles, [
			"common/units/equipment/infantry.txt",
			"common/units/equipment/tank/armor.txt",
		]);
	});

	it("does not broaden the nested watcher beyond one directory", () => {
		assert.strictEqual(matches("common/units/equipment/air/jet/new.txt"), false);
	});
});

describe("previewdef/technology equipment archetype cache", () => {
	const originalListFiles = fileloader.listFilesFromModOrHOI4;
	const originalReadFile = fileloader.readFileFromModOrHOI4;
	const originalExpiryToken = fileloader.hoiFilesExpiryToken;
	let files: Record<string, string>;

	beforeEach(() => {
		files = {
			"common/units/equipment/infantry.txt": equipmentFile("infantry_equipment", "infantry"),
		};
		handOver({ workspace: { getConfiguration: () => ({ localisationIndex: true }) } });
		refreshFeatureFlags();
	});

	afterEach(() => {
		(fileloader as any).listFilesFromModOrHOI4 = originalListFiles;
		(fileloader as any).readFileFromModOrHOI4 = originalReadFile;
		(fileloader as any).hoiFilesExpiryToken = originalExpiryToken;
		refreshFeatureFlags();
	});

	function equipmentFile(id: string, archetype: string): string {
		return `equipments = { ${id} = { short_name = ${id}_short archetype = ${archetype} is_archetype = yes } }`;
	}

	function waitPastRecentAccessWindow(): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, 210));
	}

	it("reloads cached archetypes when an equipment file is created or removed", async () => {
		(fileloader as any).listFilesFromModOrHOI4 = async (folder: string) =>
			Object.keys(files)
				.filter((path) => path.startsWith(`${folder}/`))
				.map((path) => path.slice(folder.length + 1));
		(fileloader as any).readFileFromModOrHOI4 = async (path: string) => [Buffer.from(files[path]), path];
		(fileloader as any).hoiFilesExpiryToken = async (paths: string[]) =>
			paths.map((path) => `${path}@${files[path] ?? "gone"}`).join("|");

		const technologyLoaderModule = fresh<typeof import("../../../../previewdef/technology/loader")>(
			"../../previewdef/technology/loader",
		);
		const newLoader = () => {
			const loader = new technologyLoaderModule.TechnologyTreeLoader("common/technologies/test.txt");
			(loader as any).loaderDependencies.loadMultiple = async () => [];
			return loader;
		};
		const postLoad = async () => {
			const loader = newLoader();
			return (loader as any).postLoad("technologies = {}", [], undefined, new LoaderSession(true));
		};
		const initial = await postLoad();
		assert.deepStrictEqual(Object.keys(initial.result.equipmentArchetypes), ["infantry_equipment"]);
		assert.ok(initial.dependencies.includes("common/units/equipment/*"));
		assert.ok(initial.dependencies.includes("common/units/equipment/*/*"));

		files["common/units/equipment/tank.txt"] = equipmentFile("tank_equipment", "tank");
		invalidateFileDiscoveryCache();
		await waitPastRecentAccessWindow();
		const afterCreate = await postLoad();
		assert.deepStrictEqual(Object.keys(afterCreate.result.equipmentArchetypes), ["infantry_equipment", "tank_equipment"]);
		assert.ok(afterCreate.dependencies.includes("common/units/equipment/infantry.txt"));
		assert.ok(afterCreate.dependencies.includes("common/units/equipment/tank.txt"));
		assert.deepStrictEqual(afterCreate.dependencies.filter((dependency: string) => dependency.includes("common/units/equipment")), [
			"common/units/equipment/infantry.txt",
			"common/units/equipment/tank.txt",
			"common/units/equipment/*",
			"common/units/equipment/*/*",
		]);

		files["common/units/equipment/infantry.txt"] = equipmentFile("updated_infantry_equipment", "infantry");
		await waitPastRecentAccessWindow();
		const afterEdit = await postLoad();
		assert.deepStrictEqual(Object.keys(afterEdit.result.equipmentArchetypes), ["updated_infantry_equipment", "tank_equipment"]);

		delete files["common/units/equipment/tank.txt"];
		invalidateFileDiscoveryCache();
		await waitPastRecentAccessWindow();
		const afterDelete = await postLoad();
		assert.deepStrictEqual(Object.keys(afterDelete.result.equipmentArchetypes), ["updated_infantry_equipment"]);
		assert.ok(afterDelete.dependencies.includes("common/units/equipment/infantry.txt"));
		assert.ok(!afterDelete.dependencies.includes("common/units/equipment/tank.txt"));
	});
});
