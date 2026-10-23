import * as assert from "assert";
import type * as vscode from "vscode";
import { refreshFeatureFlags } from "../../../util/featureflags";
import {
	parseLocalisation,
	getLocalisedText,
	__resetLocalisationIndexForTests,
	__testHandlers,
} from "../../../util/localisationIndex";
import { clearParentModCache } from "../../../util/parentmods";
import { deferred, settle } from "../async";
import { IndexWorld, listed, useIndexWorld, workspaceFile } from "../indexes";

// The lazy build and the event handlers every index shares are in indexWatchers.test.ts.

function yml(...lines: string[]): Buffer {
	return Buffer.from(lines.join("\n"));
}

describe("util/localisationIndex", () => {
	describe("parseLocalisation", () => {
		it("parses entries with and without a version number", () => {
			const result = parseLocalisation(yml("l_english:", ' KEY_A:0 "value a"', ' KEY_B:3 "value b"', ' KEY_C: "value c"').toString());
			assert.deepStrictEqual(result.l_english, { KEY_A: "value a", KEY_B: "value b", KEY_C: "value c" });
		});

		// Regression for #26: a value with no closing quote used to poison every entry after it in
		// the same file when parsed through js-yaml.
		it("does not let a malformed entry (missing closing quote) corrupt later entries", () => {
			const result = parseLocalisation(
				yml("l_russian:", ' EYE_ALV_fascism_ADJ:0 "Великозёрск', ' EYE_KRV_neutrality:0 "Хестрайская Конфедерация"').toString(),
			);
			assert.strictEqual(result.l_russian?.EYE_KRV_neutrality, "Хестрайская Конфедерация");
			assert.strictEqual(result.l_russian?.EYE_ALV_fascism_ADJ, undefined);
		});

		it("preserves quotes embedded inside a value", () => {
			assert.strictEqual(parseLocalisation('l_english:\n KEY:0 "a "b" c"').l_english?.KEY, 'a "b" c');
		});

		it("ignores comment lines and blank lines", () => {
			const result = parseLocalisation(yml("# a comment", "l_english:", "", "   # indented comment", ' KEY:0 "value"').toString());
			assert.deepStrictEqual(result.l_english, { KEY: "value" });
		});

		it("does not capture a trailing comment into the value", () => {
			assert.strictEqual(parseLocalisation('l_english:\n KEY:0 "value" # trailing comment').l_english?.KEY, "value");
		});

		it("switches language buckets on each header", () => {
			const result = parseLocalisation(yml("l_english:", ' KEY:0 "english"', "l_russian:", ' KEY:0 "russian"').toString());
			assert.strictEqual(result.l_english?.KEY, "english");
			assert.strictEqual(result.l_russian?.KEY, "russian");
		});
	});

	describe("the index", () => {
		const world = useIndexWorld(__resetLocalisationIndexForTests, { localisationIndex: true });

		describe("multi-language files", () => {
			const unrelatedContent = yml(
				"l_english:",
				' UNRELATED_ENGLISH:0 "unrelated English"',
				"l_russian:",
				' UNRELATED_RUSSIAN:0 "unrelated Russian"',
			);

			async function assertUnrelatedEntriesRemain(): Promise<void> {
				assert.strictEqual(await getLocalisedText("UNRELATED_ENGLISH", "en"), "unrelated English");
				assert.strictEqual(await getLocalisedText("UNRELATED_RUSSIAN", "ru"), "unrelated Russian");
			}

			async function assertMultiLanguageEntries(english: string, russian: string): Promise<void> {
				assert.strictEqual(await getLocalisedText("MULTI_ENGLISH_OLD", "en"), english);
				assert.strictEqual(await getLocalisedText("MULTI_RUSSIAN_OLD", "ru"), russian);
			}

			for (const multiLanguageFile of ["all_translations.yml", "all_translations_l_french.yml"]) {
				describe(multiLanguageFile, () => {
					const file = workspaceFile(`localisation/${multiLanguageFile}`);
					let multiLanguageContent: Buffer;

					beforeEach(async () => {
						multiLanguageContent = yml("l_english:", ' MULTI_ENGLISH_OLD:0 "old English"', "l_russian:", ' MULTI_RUSSIAN_OLD:0 "old Russian"');
						world.list = (_root, half) => (half === "workspace" ? listed(["unrelated_l_english.yml"]) : []);
						world.read = (relativePath) => (relativePath.endsWith(multiLanguageFile) ? multiLanguageContent : unrelatedContent);

						await assertUnrelatedEntriesRemain();
						__testHandlers.onCreateFiles({ files: [file] });
						await settle();
						await settle();
						await assertMultiLanguageEntries("old English", "old Russian");
					});

					it("removes every parsed language when the file is deleted", async () => {
						__testHandlers.onDeleteFiles({ files: [file] });
						await settle();

						await assertMultiLanguageEntries("MULTI_ENGLISH_OLD", "MULTI_RUSSIAN_OLD");
						await assertUnrelatedEntriesRemain();
					});

					it("clears prior languages when the file is re-indexed", async () => {
						multiLanguageContent = yml("l_french:", ' MULTI_FRENCH_NEW:0 "new French"');
						__testHandlers.onCloseTextDocument({ uri: file, isDirty: true } as vscode.TextDocument);
						await settle();
						await settle();

						await assertMultiLanguageEntries("MULTI_ENGLISH_OLD", "MULTI_RUSSIAN_OLD");
						assert.strictEqual(await getLocalisedText("MULTI_FRENCH_NEW", "fr"), "new French");
						await assertUnrelatedEntriesRemain();
					});
				});
			}
		});

		// Three halves, looked up in the game's order: the working mod, then the mods it extends, then
		// vanilla. Each half here defines the same key in a differently named file, which is exactly
		// the case a single shared half decided by parse order.
		describe("parent mods", () => {
			const files: Record<string, Buffer> = {
				"localisation/vanilla_l_english.yml": yml("l_english:", ' SHARED:0 "vanilla"', ' VANILLA_ONLY:0 "vanilla only"'),
				"localisation/parent_l_english.yml": yml("l_english:", ' SHARED:0 "parent"', ' PARENT_ONLY:0 "parent only"'),
				"localisation/sub_l_english.yml": yml("l_english:", ' SHARED:0 "workspace"'),
			};
			let releaseWorkspaceRead: () => void;

			beforeEach(() => {
				useParent(world);
				const workspaceRead = deferred();
				releaseWorkspaceRead = () => workspaceRead.resolve();
				const names = { global: "vanilla_l_english.yml", parent: "parent_l_english.yml", workspace: "sub_l_english.yml" };
				world.list = (_root, half) => listed([names[half]]);
				world.read = async (relativePath) => {
					if (relativePath.endsWith("sub_l_english.yml")) {
						// The workspace half parses first, so a last-wins bug would show the parent's text.
						await workspaceRead.promise;
					}
					return files[relativePath]!;
				};
			});

			it("answers from the working mod, then the parent, then vanilla", async () => {
				const lookup = getLocalisedText("SHARED", "en");
				await settle();
				releaseWorkspaceRead();

				assert.strictEqual(await lookup, "workspace");
				assert.strictEqual(await getLocalisedText("PARENT_ONLY", "en"), "parent only");
				assert.strictEqual(await getLocalisedText("VANILLA_ONLY", "en"), "vanilla only");
			});

			it("falls back to the parent, then vanilla, as the workspace files that shadow them go", async () => {
				releaseWorkspaceRead();
				assert.strictEqual(await getLocalisedText("SHARED", "en"), "workspace");

				__testHandlers.onDeleteFiles({ files: [workspaceFile("localisation/sub_l_english.yml")] });
				await settle();
				assert.strictEqual(await getLocalisedText("SHARED", "en"), "parent");
			});
		});

		describe("disk cache", () => {
			beforeEach(() => world.useDisk());

			// The cache writes are fire-and-forget behind the build promise, so a second build must wait
			// until the half's data file and the manifest written after it are both on disk.
			async function waitForCache(cacheName: string): Promise<void> {
				for (let i = 0; i < 100; i++) {
					if (world.disk.has(`${cacheName}.data.jsonl`) && world.disk.has(`${cacheName}.manifest.json`)) {
						return;
					}
					await settle();
				}
				throw new Error(`${cacheName} cache was never written`);
			}

			// What the next session starts from: an empty index over the same cache.
			function reload(): void {
				__resetLocalisationIndexForTests();
				clearParentModCache();
				refreshFeatureFlags();
			}

			// Regression for the warm parent-localisation cache: the parent half used to cache without
			// its per-file key map, so a warm build's hydrate had nothing to restore from. It restored
			// no parent keys and parsed no fresh files, leaving the parent half empty after every reload.
			describe("warm parent cache", () => {
				const reads = { global: 0, parent: 0, workspace: 0 };

				beforeEach(() => {
					useParent(world);
					Object.assign(reads, { global: 0, parent: 0, workspace: 0 });
					// The global and parent halves list one file each; the workspace half lists nothing.
					world.list = (_root, half) =>
						half === "global" ? listed(["global_l_english.yml"]) : half === "parent" ? listed(["parent_l_english.yml"]) : [];
					world.read = (_relativePath, half) => {
						reads[half]++;
						return half === "global"
							? yml("l_english:", ' GLOBAL_ONLY:0 "global only"')
							: yml("l_english:", ' PARENT_ONLY:0 "parent only"');
					};
				});

				it("cold build parses the parent file and saves its key with fileMap data", async () => {
					assert.strictEqual(await getLocalisedText("PARENT_ONLY", "en"), "parent only");
					assert.strictEqual(reads.parent, 1);
					await waitForCache("localisationIndex.parent.0");

					// The records, `[langKey, filePath, entries]`, then their count. The listing path
					// carries the localisation root, so match on the entries the file owns.
					const lines = Buffer.from(world.disk.get("localisationIndex.parent.0.data.jsonl")!)
						.toString()
						.split("\n")
						.filter((line) => line !== "")
						.map((line) => JSON.parse(line));
					assert.strictEqual(lines.pop(), lines.length);
					assert.deepStrictEqual(
						lines.map(([langKey, , entries]) => [langKey, entries]),
						[["l_english", { PARENT_ONLY: "parent only" }]],
					);
				});

				it("warm build serves a global key from the cache without re-reading the global file", async () => {
					assert.strictEqual(await getLocalisedText("GLOBAL_ONLY", "en"), "global only");
					assert.strictEqual(reads.global, 1);
					await waitForCache("localisationIndex.global");

					reload();
					assert.strictEqual(await getLocalisedText("GLOBAL_ONLY", "en"), "global only");
					assert.strictEqual(reads.global, 1);
				});

				it("warm build serves the parent key from the cache without re-reading the parent file", async () => {
					assert.strictEqual(await getLocalisedText("PARENT_ONLY", "en"), "parent only");
					await waitForCache("localisationIndex.parent.0");

					reload();
					assert.strictEqual(await getLocalisedText("PARENT_ONLY", "en"), "parent only");
					// The whole point of the cache: the parent file was parsed by the cold build only.
					assert.strictEqual(reads.parent, 1);
				});
			});

			describe("duplicate keys", () => {
				it("rebuilds all current files when a duplicate-key owner is removed", async () => {
					let files = ["first_l_english.yml", "second_l_english.yml"];
					world.list = (_root, half) => (half === "workspace" ? listed(files) : []);
					world.read = (relativePath) =>
						yml("l_english:", ` DUPLICATE:0 "${relativePath.includes("first") ? "first" : "second"}"`);

					assert.strictEqual(await getLocalisedText("DUPLICATE", "en"), "second");
					await waitForCache("localisationIndex.workspace");

					files = ["first_l_english.yml"];
					reload();
					assert.strictEqual(await getLocalisedText("DUPLICATE", "en"), "first");
				});
			});
		});
	});
});

function useParent(world: IndexWorld): void {
	world.settings = { localisationIndex: true, parentModPaths: ["D:/mods/parent"] };
	refreshFeatureFlags();
	clearParentModCache();
}
