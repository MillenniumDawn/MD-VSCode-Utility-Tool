import * as assert from "assert";
import { mock } from "node:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as fileloader from "../../../../util/fileloader";
import * as gfxindex from "../../../../util/gfxindex";
import { LoaderSession } from "../../../../util/loader/loader";
import { MioLoader } from "../../../../previewdef/mio/loader";
import { Logger } from "../../../../util/logger";
import { handOver } from "../../host";

describe("previewdef/mio/loader organization includes", () => {
	const folder = "common/military_industrial_organization/organizations";
	let root: string;
	let errors: string[];
	let icons: (string | undefined)[];

	async function write(file: string, content: string): Promise<void> {
		const target = path.join(root, file);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, content);
	}

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "mio-loader-"));
		errors = [];
		icons = [];
		handOver({ workspace: { getConfiguration: () => ({}) } });
		mock.method(Logger, "error", (message: string) => errors.push(message));
		mock.method(console, "error", () => undefined);
		mock.method(gfxindex, "getGfxContainerFiles", async (names: (string | undefined)[]) => {
			icons.push(...names);
			return names.includes("GFX_inherited") ? ["interface/inherited.gfx"] : [];
		});
		// Only the editor's filesystem boundary is replaced. Actual files, dependency loading,
		// parsing, include resolution and reload decisions all run together.
		mock.method(fileloader, "listFilesFromModOrHOI4", async (dir: string) => fs.readdir(path.join(root, dir)));
		mock.method(fileloader, "readFileFromModOrHOI4", async (file: string) => [await fs.readFile(path.join(root, file)), file]);
		mock.method(fileloader, "hoiFileExpiryToken", async (file: string) => {
			try { return (await fs.readFile(path.join(root, file))).toString(); }
			catch { return "missing"; }
		});
		await write(`${folder}/00_generic_organization.txt`, "generic = { }");
	});

	afterEach(async () => {
		mock.restoreAll();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("loads two independent organization files without manufacturing cycles", async () => {
		await write(`${folder}/A.txt`, "a = { trait = { token = a_trait } }");
		await write(`${folder}/B.txt`, "b = { trait = { token = b_trait } }");
		await write(`${folder}/notes.md`, "not hoi4 syntax");
		const { result, dependencies } = await new MioLoader(`${folder}/A.txt`).load(new LoaderSession(false));
		assert.deepStrictEqual(result.mios.map(mio => mio.id), ["a"]);
		assert.deepStrictEqual(Object.keys(result.mios[0]!.traits), ["a_trait"]);
		assert.deepStrictEqual(errors, []);
		assert.ok(dependencies.includes(`${folder}/*`));
		assert.ok(dependencies.includes(`${folder}/B.txt`));
		assert.ok(!dependencies.includes(`${folder}/notes.md`));
	});

	it("resolves cross-file chains and same-file forward includes with source navigation and GFX", async () => {
		await write(`${folder}/A.txt`, "a = { include = b add_trait = { token = a_trait } }");
		await write(`${folder}/B.txt`, "b = { include = forward } forward = { include = c }");
		await write(`${folder}/C.txt`, "c = { trait = { token = inherited icon = GFX_inherited } }");
		const { result, dependencies } = await new MioLoader(`${folder}/A.txt`).load(new LoaderSession(false));
		assert.deepStrictEqual(Object.keys(result.mios[0]!.traits), ["inherited", "a_trait"]);
		assert.strictEqual(result.mios[0]!.traits.inherited!.file, `${folder}/C.txt`);
		assert.strictEqual(result.mios[0]!.traits.inherited!.sourceMioId, "c");
		assert.ok(icons.includes("GFX_inherited"));
		for (const file of ["interface/inherited.gfx", "interface/ideas.gfx", "interface/nationalfocusview.gfx"]) {
			assert.ok(result.gfxFiles.includes(file), file);
			assert.ok(dependencies.includes(file), file);
		}
		assert.deepStrictEqual(errors, []);
	});

	it("allows reciprocal file references when their organization chains are acyclic", async () => {
		await write(`${folder}/A.txt`, "a = { include = b_base } a_base = { trait = { token = from_a } }");
		await write(`${folder}/B.txt`, "b = { include = a_base } b_base = { trait = { token = from_b } }");
		for (const [file, id, trait] of [["A.txt", "a", "from_b"], ["B.txt", "b", "from_a"]]) {
			const { result } = await new MioLoader(`${folder}/${file}`).load(new LoaderSession(false));
			const mio = result.mios.find(item => item.id === id)!;
			assert.ok(mio.traits[trait!]);
			assert.deepStrictEqual(mio.warnings, []);
		}
		assert.deepStrictEqual(errors, []);
	});

	it("reports real cross-file include cycles as organization warnings", async () => {
		await write(`${folder}/A.txt`, "a = { include = b }");
		await write(`${folder}/B.txt`, "b = { include = a }");
		const { result } = await new MioLoader(`${folder}/A.txt`).load(new LoaderSession(false));
		assert.ok(result.mios[0]!.warnings.some(warning => warning.text.includes("a -> b -> a")));
		assert.deepStrictEqual(errors, []);
	});

	it("follows explicit dependencies outside the folder transitively, even reciprocal file declarations", async () => {
		await write(`${folder}/A.txt`, "#!mio:extra/B.txt\na = { include = b }");
		await write("extra/B.txt", "#!mio:extra/C.txt\n#!gfx:interface/custom.gfx\nb = { include = c }");
		await write("extra/C.txt", `#!mio:${folder}/A.txt\nc = { trait = { token = extra } }`);
		const { result, dependencies } = await new MioLoader(`${folder}/A.txt`).load(new LoaderSession(false));
		assert.ok(result.mios[0]!.traits.extra);
		assert.ok(result.gfxFiles.includes("interface/custom.gfx"));
		for (const file of ["extra/B.txt", "extra/C.txt", "interface/custom.gfx"]) {
			assert.ok(dependencies.includes(file), file);
		}
		assert.deepStrictEqual(errors, []);
	});

	it("keeps a nested file's explicit dependency ahead of a competing generic definition", async () => {
		await write(`${folder}/A.txt`, "#!mio:extra/B.txt\na = { include = b }");
		await write(`${folder}/00_generic_organization.txt`, "base = { trait = { token = automatic } }");
		await write("extra/B.txt", "#!mio:extra/C.txt\nb = { include = base }");
		await write("extra/C.txt", "base = { trait = { token = explicit } }");
		const { result } = await new MioLoader(`${folder}/A.txt`).load(new LoaderSession(false));
		assert.deepStrictEqual(Object.keys(result.mios[0]!.traits), ["explicit"]);
		assert.strictEqual(result.mios[0]!.traits.explicit!.file, "extra/C.txt");
		assert.deepStrictEqual(errors, []);
	});

	it("refreshes unchanged editor content after a dependency edit and forced folder change", async () => {
		const loader = new MioLoader(`${folder}/A.txt`, async () => "a = { include = b }");
		await write(`${folder}/B.txt`, "b = { trait = { token = old } }");
		assert.ok((await loader.load(new LoaderSession(false))).result.mios[0]!.traits.old);
		await write(`${folder}/B.txt`, "b = { trait = { token = edited } }");
		assert.ok((await loader.load(new LoaderSession(false))).result.mios[0]!.traits.edited);
		await fs.rm(path.join(root, folder, "B.txt"));
		await write(`${folder}/C.txt`, "b = { trait = { token = moved } }");
		const changed = await loader.load(new LoaderSession(true));
		assert.ok(changed.result.mios[0]!.traits.moved);
		assert.ok(changed.dependencies.includes(`${folder}/C.txt`));
		assert.ok(!changed.dependencies.includes(`${folder}/B.txt`));
		assert.deepStrictEqual(errors, []);
	});
});
