import * as assert from "assert";
import * as vscode from "vscode";
import { CharactersLoader } from "../previewdef/character/loader";
import { LoaderSession } from "../util/loader/loader";
import { clearDlcZipCache } from "../util/fileloader";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// Drives CharactersLoader.postLoad against a stubbed mod tree holding one trait file per trait
// directory and one modifier-definitions file, served from the HOI4 install path (no workspace
// folders).
//
// What is being pinned is the dependency list. A character card says nothing on its own: every
// modifier on it was read out of a trait file, and how that modifier is spelled was read out of
// common/modifier_definitions. Report only the character file, as this loader first did, and editing
// a trait leaves an open preview showing the numbers from before the edit until the character file
// is touched or the panel is reopened -- silently, which is the worst way for a preview to be wrong.
describe("previewdef/character/loader dependencies", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;

	function uriPath(uri: any): string {
		return String(uri.fsPath ?? uri.path ?? "");
	}

	// Which directory of the stub tree a uri is in, or undefined for anything else.
	const directories: Record<string, string[]> = {
		country_leader: ["00_traits.txt", "notes.md"],
		unit_leader: ["01_army_leader_traits.txt"],
		scientist_traits: ["00_traits.txt"],
		modifier_definitions: ["00_modifier_definitions.txt"],
	};

	function directoryOf(uri: any): string | undefined {
		const path = uriPath(uri).replace(/\\/g, "/");
		return Object.keys(directories).find((name) =>
			new RegExp(`(^|/)common/${name}$`).test(path),
		);
	}

	beforeEach(function () {
		stubVscode({
			configuration: { modFile: "", loadDlcContents: false },
			stat: async (uri: any) => ({
				type: directoryOf(uri) !== undefined ? Directory : File,
				mtime: 1,
				ctime: 0,
				size: 0,
			}),
			readDirectory: async (uri: any) => {
				const directory = directoryOf(uri);
				return directory === undefined
					? []
					: directories[directory]!.map((f) => [f, File] as [string, vscode.FileType]);
			},
			readFile: async () => Buffer.from("leader_traits = { }"),
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		// Drop the 3s directory-listing cache so listings don't leak between tests.
		await clearDlcZipCache();
	});

	function postLoad(content: string): Promise<any> {
		const loader = new CharactersLoader("common/characters/TST.txt");
		return (loader as any).postLoad(content, [], undefined, new LoaderSession(true));
	}

	const characters = `characters = {
    TST_someone = {
        advisor = { slot = army_chief traits = { army_chief_planning_3 } }
    }
}`;

	it("reports every trait file and modifier-definitions file it read, beside the character file", async function () {
		const result = await postLoad(characters);

		assert.deepStrictEqual(result.dependencies, [
			"common/characters/TST.txt",
			"common/country_leader/00_traits.txt",
			"common/unit_leader/01_army_leader_traits.txt",
			"common/scientist_traits/00_traits.txt",
			"common/modifier_definitions/00_modifier_definitions.txt",
		]);
	});

	it("leaves out what it never read", async function () {
		const result = await postLoad(characters);

		// A .md sitting in a trait directory is not a trait file and is not parsed, so an edit to it
		// has nothing to bring the preview back for.
		assert.ok(!result.dependencies.includes("common/country_leader/notes.md"));
	});

	it("still parses the characters it was given", async function () {
		const result = await postLoad(characters);

		assert.deepStrictEqual(
			result.result.characters.characters.map((c: any) => c.id),
			["TST_someone"],
		);
	});
});
