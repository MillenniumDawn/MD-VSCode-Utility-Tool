import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import {
	parseLocalisation,
	getLocalisedText,
	registerLocalisationIndex,
	__resetLocalisationIndexForTests,
	__testHandlers,
} from "../util/localisationIndex";
import { clearParentModCache } from "../util/parentmods";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

describe("util/localisationIndex", () => {
	describe("parseLocalisation", () => {
		it("parses entries with and without a version number", () => {
			const result = parseLocalisation(
				[
					"l_english:",
					' KEY_A:0 "value a"',
					' KEY_B:3 "value b"',
					' KEY_C: "value c"',
				].join("\n"),
			);
			assert.deepStrictEqual(result.l_english, {
				KEY_A: "value a",
				KEY_B: "value b",
				KEY_C: "value c",
			});
		});

		it("does not let a malformed entry (missing closing quote) corrupt later entries", () => {
			// Regression for #26: a value with no closing quote used to poison every entry after
			// it in the same file when parsed through js-yaml.
			const result = parseLocalisation(
				[
					"l_russian:",
					' EYE_ALV_fascism_ADJ:0 "Великозёрск',
					' EYE_KRV_neutrality:0 "Хестрайская Конфедерация"',
				].join("\n"),
			);
			assert.strictEqual(
				result.l_russian.EYE_KRV_neutrality,
				"Хестрайская Конфедерация",
			);
			assert.strictEqual(result.l_russian.EYE_ALV_fascism_ADJ, undefined);
		});

		it("preserves quotes embedded inside a value", () => {
			const result = parseLocalisation(
				["l_english:", ' KEY:0 "a "b" c"'].join("\n"),
			);
			assert.strictEqual(result.l_english.KEY, 'a "b" c');
		});

		it("ignores comment lines and blank lines", () => {
			const result = parseLocalisation(
				[
					"# a comment",
					"l_english:",
					"",
					"   # indented comment",
					' KEY:0 "value"',
				].join("\n"),
			);
			assert.deepStrictEqual(result.l_english, { KEY: "value" });
		});

		it("does not capture a trailing comment into the value", () => {
			const result = parseLocalisation(
				'l_english:\n KEY:0 "value" # trailing comment',
			);
			assert.strictEqual(result.l_english.KEY, "value");
		});

		it("switches language buckets on each header", () => {
			const result = parseLocalisation(
				[
					"l_english:",
					' KEY:0 "english"',
					"l_russian:",
					' KEY:0 "russian"',
				].join("\n"),
			);
			assert.strictEqual(result.l_english.KEY, "english");
			assert.strictEqual(result.l_russian.KEY, "russian");
		});
	});
});

type ListedEntry = {
	relativePath: string;
	uri: unknown;
	mtime: number | undefined;
};

type FileloaderModule = {
	listFileEntriesFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			workspace?: boolean;
			parent?: boolean;
			recursively?: boolean;
			token?: unknown;
		},
	) => Promise<ListedEntry[]>;
	readFileFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			workspace?: boolean;
			parent?: boolean;
		},
	) => Promise<[Buffer, unknown]>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

// A dated entry is what a listing on a real disk produces; leaving the mtime out would send
// listIndexFiles down its resolve-and-stat fallback and out to the unstubbed file system.
function toEntries(names: string[]): ListedEntry[] {
	return names.map((relativePath) => ({
		relativePath,
		uri: undefined,
		mtime: 1,
	}));
}

const LOC_FILE_CONTENT = Buffer.from('l_english:\n KEY_A:0 "Value A"\n');

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
	let resolve: (v: T) => void = () => undefined;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const WORKSPACE_FOLDER = {
	uri: { path: "/ws", scheme: "file", toString: () => "file:///ws" },
} as unknown as vscode.WorkspaceFolder;

function locFileUri(relativePath: string): vscode.Uri {
	const fullPath = "/ws/" + relativePath;
	return {
		path: fullPath,
		scheme: "file",
		toString: () => "file://" + fullPath,
	} as unknown as vscode.Uri;
}

describe("util/localisationIndex lazy build", function () {
	let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let listFilesCallCount: number;

	beforeEach(function () {
		__resetLocalisationIndexForTests();
		stubVscode({
			getConfiguration: () => ({ localisationIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		featureflags.refreshFeatureFlags();

		listFilesCallCount = 0;
		originalListFiles = fileloader.listFileEntriesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;

		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = async () => {
			listFilesCallCount++;
			return toEntries(["test_l_english.yml"]);
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async () => [LOC_FILE_CONTENT, {} as unknown];
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = originalListFiles;
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = originalReadFile;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		__resetLocalisationIndexForTests();
	});

	it("does no build work when registered", async function () {
		const disposable = registerLocalisationIndex();
		await waitForAsyncTasks();

		assert.strictEqual(listFilesCallCount, 0);
		disposable.dispose();
	});

	it("does no build work when the feature flag is off", async function () {
		stubVscode({ getConfiguration: () => ({ localisationIndex: false }) });
		featureflags.refreshFeatureFlags();

		const result = await getLocalisedText("KEY_A", "en");

		assert.strictEqual(result, "KEY_A");
		assert.strictEqual(listFilesCallCount, 0);
	});

	it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async function () {
		const [first, second] = await Promise.all([
			getLocalisedText("KEY_A", "en"),
			getLocalisedText("KEY_A", "en"),
		]);

		// One list call for the global build, one for the workspace build; a duplicate build would double these.
		assert.strictEqual(listFilesCallCount, 2);
		assert.strictEqual(first, "Value A");
		assert.strictEqual(second, "Value A");

		const third = await getLocalisedText("KEY_A", "en");
		assert.strictEqual(third, "Value A");
		assert.strictEqual(listFilesCallCount, 2);
	});

	describe("incremental events vs. an in-flight build", function () {
		// The global build passes { hoi4: true, ... }, the workspace build { hoi4: false, ... };
		// route the file into the workspace build only, so getLocalisedText's fallback to the
		// global index can't mask a workspace-only mutation.
		beforeEach(function () {
			(
				fileloader as typeof fileloader & {
					listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
				}
			).listFileEntriesFromModOrHOI4 = async (_relativePath, options) => {
				listFilesCallCount++;
				return toEntries(options?.hoi4 ? [] : ["test_l_english.yml"]);
			};
		});

		it("ignores incremental events that arrive before any build has started", async function () {
			__testHandlers.onDeleteFiles({
				files: [locFileUri("localisation/test_l_english.yml")],
			});
			await waitForAsyncTasks();

			assert.strictEqual(listFilesCallCount, 0);

			const result = await getLocalisedText("KEY_A", "en");
			assert.strictEqual(result, "Value A");
		});

		it("defers an event that arrives while the build is pending, and applies it once the build settles", async function () {
			const read = deferred<[Buffer, unknown]>();
			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = () => read.promise;

			const lookup = getLocalisedText("KEY_A", "en");
			await waitForAsyncTasks();

			// Fired while the build is still awaiting readFileFromModOrHOI4, before it has written
			// anything into the index.
			__testHandlers.onDeleteFiles({
				files: [locFileUri("localisation/test_l_english.yml")],
			});

			read.resolve([LOC_FILE_CONTENT, {} as unknown]);
			await lookup;
			await waitForAsyncTasks();

			const result = await getLocalisedText("KEY_A", "en");
			assert.strictEqual(result, "KEY_A");
		});

		it("applies an event immediately once the build has already settled", async function () {
			const primed = await getLocalisedText("KEY_A", "en");
			assert.strictEqual(primed, "Value A");

			__testHandlers.onDeleteFiles({
				files: [locFileUri("localisation/test_l_english.yml")],
			});

			const result = await getLocalisedText("KEY_A", "en");
			assert.strictEqual(result, "KEY_A");
		});

		describe("multi-language files", function () {
			const multiLanguageFiles = [
				"all_translations.yml",
				"all_translations_l_french.yml",
			];
			const UNRELATED_FILE = "unrelated_l_english.yml";
			const unrelatedContent = Buffer.from(
				[
					"l_english:",
					' UNRELATED_ENGLISH:0 "unrelated English"',
					"l_russian:",
					' UNRELATED_RUSSIAN:0 "unrelated Russian"',
				].join("\n"),
			);

			async function assertUnrelatedEntriesRemain(): Promise<void> {
				assert.strictEqual(
					await getLocalisedText("UNRELATED_ENGLISH", "en"),
					"unrelated English",
				);
				assert.strictEqual(
					await getLocalisedText("UNRELATED_RUSSIAN", "ru"),
					"unrelated Russian",
				);
			}

			function testMultiLanguageFile(multiLanguageFile: string): void {
				describe(multiLanguageFile, function () {
					let multiLanguageContent: Buffer;

					beforeEach(function () {
						multiLanguageContent = Buffer.from(
							[
								"l_english:",
								' MULTI_ENGLISH_OLD:0 "old English"',
								"l_russian:",
								' MULTI_RUSSIAN_OLD:0 "old Russian"',
							].join("\n"),
						);
						(
							fileloader as typeof fileloader & {
								listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
							}
						).listFileEntriesFromModOrHOI4 = async (_relativePath, options) => {
							listFilesCallCount++;
							return options?.mod ? toEntries([UNRELATED_FILE]) : [];
						};
						(
							fileloader as typeof fileloader & {
								readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
							}
						).readFileFromModOrHOI4 = async (relativePath) => {
							if (relativePath.endsWith(multiLanguageFile)) {
								return [multiLanguageContent, {} as unknown];
							}
							return [unrelatedContent, {} as unknown];
						};
					});

					async function indexMultiLanguageFile(): Promise<void> {
						__testHandlers.onCreateFiles({
							files: [locFileUri(`localisation/${multiLanguageFile}`)],
						});
						await waitForAsyncTasks();
						await waitForAsyncTasks();
					}

					async function assertMultiLanguageEntriesPresent(): Promise<void> {
						assert.strictEqual(
							await getLocalisedText("MULTI_ENGLISH_OLD", "en"),
							"old English",
						);
						assert.strictEqual(
							await getLocalisedText("MULTI_RUSSIAN_OLD", "ru"),
							"old Russian",
						);
					}

					async function assertOldMultiLanguageEntriesAreGone(): Promise<void> {
						assert.strictEqual(
							await getLocalisedText("MULTI_ENGLISH_OLD", "en"),
							"MULTI_ENGLISH_OLD",
						);
						assert.strictEqual(
							await getLocalisedText("MULTI_RUSSIAN_OLD", "ru"),
							"MULTI_RUSSIAN_OLD",
						);
					}

					it("removes every parsed language when the file is deleted", async function () {
						await assertUnrelatedEntriesRemain();
						await indexMultiLanguageFile();
						await assertMultiLanguageEntriesPresent();

						__testHandlers.onDeleteFiles({
							files: [locFileUri(`localisation/${multiLanguageFile}`)],
						});
						await waitForAsyncTasks();

						await assertOldMultiLanguageEntriesAreGone();
						await assertUnrelatedEntriesRemain();
					});

					it("clears prior languages when the file is re-indexed", async function () {
						await assertUnrelatedEntriesRemain();
						await indexMultiLanguageFile();
						await assertMultiLanguageEntriesPresent();

						multiLanguageContent = Buffer.from(
							["l_french:", ' MULTI_FRENCH_NEW:0 "new French"'].join("\n"),
						);
						__testHandlers.onCloseTextDocument({
							uri: locFileUri(`localisation/${multiLanguageFile}`),
							isDirty: true,
						} as vscode.TextDocument);
						await waitForAsyncTasks();
						await waitForAsyncTasks();

						await assertOldMultiLanguageEntriesAreGone();
						assert.strictEqual(
							await getLocalisedText("MULTI_FRENCH_NEW", "fr"),
							"new French",
						);
						await assertUnrelatedEntriesRemain();
					});
				});
			}

			for (const multiLanguageFile of multiLanguageFiles) {
				testMultiLanguageFile(multiLanguageFile);
			}
		});
	});
});

// Three halves, looked up in the game's order: the working mod, then the mods it extends, then
// vanilla. Each half here defines the same key in a differently named file, which is exactly the
// case a single shared half decided by parse order.
describe("util/localisationIndex parent mods", function () {
	function yml(...lines: string[]): Buffer {
		return Buffer.from(
			["l_english:", ...lines.map((line) => " " + line), ""].join(
				String.fromCharCode(10),
			),
		);
	}
	const files: Record<string, Buffer> = {
		"localisation/vanilla_l_english.yml": yml(
			'SHARED:0 "vanilla"',
			'VANILLA_ONLY:0 "vanilla only"',
		),
		"localisation/parent_l_english.yml": yml(
			'SHARED:0 "parent"',
			'PARENT_ONLY:0 "parent only"',
		),
		"localisation/sub_l_english.yml": yml('SHARED:0 "workspace"'),
	};
	let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let releaseWorkspaceRead: () => void;

	beforeEach(function () {
		__resetLocalisationIndexForTests();
		stubVscode({
			getConfiguration: () => ({
				localisationIndex: true,
				parentModPaths: ["D:/mods/parent"],
			}),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		clearParentModCache();
		featureflags.refreshFeatureFlags();
		const workspaceRead = deferred<void>();
		releaseWorkspaceRead = () => workspaceRead.resolve(undefined);

		originalListFiles = fileloader.listFileEntriesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;
		(fileloader as any).listFileEntriesFromModOrHOI4 = async (
			_p: string,
			options: any,
		) => {
			if (options?.mod === false) {
				return toEntries(["vanilla_l_english.yml"]);
			}
			if (options?.workspace === false) {
				return toEntries(["parent_l_english.yml"]);
			}
			return toEntries(["sub_l_english.yml"]);
		};
		(fileloader as any).readFileFromModOrHOI4 = async (
			relativePath: string,
		) => {
			if (relativePath.endsWith("sub_l_english.yml")) {
				// The workspace half parses first, so a last-wins bug would show the parent's text.
				await workspaceRead.promise;
			}
			return [files[relativePath], {}];
		};
	});

	afterEach(function () {
		(fileloader as any).listFileEntriesFromModOrHOI4 = originalListFiles;
		(fileloader as any).readFileFromModOrHOI4 = originalReadFile;
		restoreVscodeStubs();
		clearParentModCache();
		featureflags.refreshFeatureFlags();
		__resetLocalisationIndexForTests();
	});

	it("answers from the working mod, then the parent, then vanilla", async function () {
		const lookup = getLocalisedText("SHARED", "en");
		await waitForAsyncTasks();
		releaseWorkspaceRead();

		assert.strictEqual(await lookup, "workspace");
		assert.strictEqual(
			await getLocalisedText("PARENT_ONLY", "en"),
			"parent only",
		);
		assert.strictEqual(
			await getLocalisedText("VANILLA_ONLY", "en"),
			"vanilla only",
		);
	});

	it("falls back to the parent, then vanilla, as the workspace files that shadow them go", async function () {
		releaseWorkspaceRead();
		assert.strictEqual(await getLocalisedText("SHARED", "en"), "workspace");

		__testHandlers.onDeleteFiles({
			files: [locFileUri("localisation/sub_l_english.yml")],
		});
		await waitForAsyncTasks();
		assert.strictEqual(await getLocalisedText("SHARED", "en"), "parent");
	});
});
