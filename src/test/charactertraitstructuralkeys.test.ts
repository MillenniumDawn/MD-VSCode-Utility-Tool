import * as assert from "assert";
import * as vscode from "vscode";
import { loadCharacterTraits } from "../util/characterTraits";
import { clearDlcZipCache } from "../util/fileloader";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// A mod names the flat trait keys that are not modifiers in the characterTraitStructuralKeys
// setting or a character_trait_structural_keys list in its .mod file; the built-in list covers the
// base game's own. Issue #452.
describe("util/characterTraits structural keys from the setting and the .mod file", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;
	let files: Map<string, string>;
	let directories: Record<string, [string, vscode.FileType][]>;
	let counter = 0;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/\\/g, "/")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\/?/, "");
	}

	function configure(characterTraitStructuralKeys: string[], descriptor?: string): void {
		// A fresh .mod and trait file per test: the descriptor and parse caches are keyed by path.
		const id = counter++;
		const modFile = `/ws/traitkeys${id}.mod`;
		files.set(modFile.replace(/^\/ws\//, ""), descriptor ?? 'name="test"\n');
		const traitFile = `traits${id}.txt`;
		files.set(`common/country_leader/${traitFile}`, `
leader_traits = {
	my_trait = {
		random = no
		my_category = land_doctrine
		army_attack_factor = 0.05
	}
}
`);
		directories["common/country_leader"] = [[traitFile, File]];
		stubVscode({
			configuration: { modFile, installPath: "", loadDlcContents: false, parentModPaths: [], characterTraitStructuralKeys },
			workspaceFolders: [
				{ uri: { fsPath: "/ws", path: "/ws", scheme: "file", toString: () => "file:///ws" } },
			],
			stat: async (uri: any) => {
				const key = rel(uri);
				if (files.has(key)) {
					return { type: File, mtime: 1, ctime: 0, size: 0 };
				}
				if (key in directories) {
					return { type: Directory, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + key);
			},
			readFile: async (uri: any) => {
				const content = files.get(rel(uri));
				if (content !== undefined) {
					return Buffer.from(content);
				}
				throw new Error("not found: " + rel(uri));
			},
			readDirectory: async (uri: any) => {
				const entries = directories[rel(uri)];
				if (entries === undefined) {
					throw new Error("not found: " + rel(uri));
				}
				return entries;
			},
		});
	}

	async function modifierKeys(): Promise<string[]> {
		const { traits } = await loadCharacterTraits();
		assert.ok(traits["my_trait"], "expected my_trait to load");
		return traits["my_trait"].modifiers.map((pair) => pair.key);
	}

	beforeEach(function () {
		files = new Map<string, string>();
		directories = { "common": [["country_leader", Directory]] };
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache();
	});

	it("reads an unknown flat key as a modifier when nothing names it", async function () {
		configure([]);
		assert.deepStrictEqual(await modifierKeys(), ["my_category", "army_attack_factor"]);
	});

	it("leaves off a key the setting names", async function () {
		configure(["My_Category"]);
		assert.deepStrictEqual(await modifierKeys(), ["army_attack_factor"]);
	});

	it("leaves off a key the .mod file names", async function () {
		configure([], 'name="test"\ncharacter_trait_structural_keys = { my_category }\n');
		assert.deepStrictEqual(await modifierKeys(), ["army_attack_factor"]);
	});
});
