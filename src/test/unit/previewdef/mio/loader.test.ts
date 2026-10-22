import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../util/fileloader";
import * as gfxindex from "../../../../util/gfxindex";
import { LoaderSession } from "../../../../util/loader/loader";
import { MioLoader } from "../../../../previewdef/mio/loader";
import { handOver } from "../../host";

describe("previewdef/mio/loader dependencies", () => {
	const folder = "common/military_industrial_organization/organizations";

	beforeEach(() => {
		handOver({ workspace: { getConfiguration: () => ({}) } });
		mock.method(gfxindex, "getGfxContainerFiles", async () => []);
		mock.method(fileloader, "listFilesFromModOrHOI4", async () => ["00_generic_organization.txt", "TST.txt", "notes.md"]);
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it("subscribes to the organizations folder as well as the files in it", async () => {
		const loader = new MioLoader("common/military_industrial_organization/organizations/TST_mio.txt", async () => "TST_mio = { }");
		(loader as any).loaderDependencies.loadMultiple = async () => [];
		const { dependencies } = await loader.load(new LoaderSession(false));

		// A file created or deleted there matches the folder pattern; no listed file could name it.
		assert.ok(dependencies.includes(`${folder}/*`), "the folder pattern is a dependency");
		assert.ok(dependencies.includes(`${folder}/TST.txt`), "a listed file is a dependency");
		assert.ok(!dependencies.includes(`${folder}/notes.md`), "a file that is not a .txt is not");
	});
});
