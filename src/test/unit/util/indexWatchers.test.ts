import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { host } from "../../../util/host";
import { refreshFeatureFlags } from "../../../util/featureflags";
import * as gfxindex from "../../../util/gfxindex";
import * as ideaSwapIndex from "../../../util/ideaSwapIndex";
import * as localisationIndex from "../../../util/localisationIndex";
import * as sharedFocusIndex from "../../../util/sharedFocusIndex";
import { deferred, settle } from "../async";
import { listed, useIndexWorld, workspaceFile } from "../indexes";

// The contract every index keeps with the editor: build nothing until something asks, build once
// however many ask at the same time, and hold an edit that arrives mid-build until the build has
// written what it read. Each index once had its own copy of these tests.

interface IndexCase {
	name: string;
	flag: string;
	reset(): void;
	register(): { dispose(): unknown };
	handlers: typeof gfxindex.__testHandlers;
	// The one file the workspace half lists, under its root.
	root: string;
	file: string;
	content: string;
	// One listing per root, for the global half and the workspace half.
	listingsPerBuild: number;
	lookup(): Promise<unknown>;
	// What the lookup answers once the file is indexed, and once it is gone.
	found: unknown;
	missing: unknown;
}

const cases: IndexCase[] = [
	{
		name: "gfx",
		flag: "gfxIndex",
		reset: gfxindex.__resetGfxIndexForTests,
		register: gfxindex.registerGfxIndex,
		handlers: gfxindex.__testHandlers,
		root: "interface",
		file: "sprite.gfx",
		content: 'spriteTypes = { spriteType = { name = "GFX_my_sprite" texturefile = "x.dds" } }',
		listingsPerBuild: 2,
		lookup: () => gfxindex.getGfxContainerFile("GFX_my_sprite"),
		found: "interface/sprite.gfx",
		missing: undefined,
	},
	{
		name: "shared focus",
		flag: "sharedFocusIndex",
		reset: sharedFocusIndex.__resetSharedFocusIndexForTests,
		register: sharedFocusIndex.registerSharedFocusIndex,
		handlers: sharedFocusIndex.__testHandlers,
		root: "common/national_focus",
		file: "shared.txt",
		content: "shared_focus = { id = my_shared_focus }",
		listingsPerBuild: 2,
		lookup: () => sharedFocusIndex.findFileByFocusKey("my_shared_focus"),
		found: "common/national_focus/shared.txt",
		missing: undefined,
	},
	{
		name: "localisation",
		flag: "localisationIndex",
		reset: localisationIndex.__resetLocalisationIndexForTests,
		register: localisationIndex.registerLocalisationIndex,
		handlers: localisationIndex.__testHandlers,
		root: "localisation",
		file: "test_l_english.yml",
		content: 'l_english:\n KEY_A:0 "Value A"\n',
		listingsPerBuild: 2,
		lookup: () => localisationIndex.getLocalisedText("KEY_A", "en"),
		found: "Value A",
		missing: "KEY_A",
	},
	{
		name: "idea swap",
		flag: "ideaSwapIndex",
		reset: ideaSwapIndex.__resetIdeaSwapIndexForTests,
		register: ideaSwapIndex.registerIdeaSwapIndex,
		handlers: ideaSwapIndex.__testHandlers,
		root: "common",
		file: "swaps.txt",
		content: "focus = { completion_reward = { swap_ideas = { remove_idea = a add_idea = b } } }",
		// Two roots, common and events.
		listingsPerBuild: 4,
		lookup: async () => (await ideaSwapIndex.getIdeaSwaps(["a"])).map((swap) => swap.file),
		found: ["common/swaps.txt"],
		missing: [],
	},
];

for (const index of cases) {
	describe(`the ${index.name} index, kept in step with the editor`, () => {
		beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
		afterEach(() => mock.timers.reset());
		const world = useIndexWorld(index.reset, { [index.flag]: true });
		const path = `${index.root}/${index.file}`;
		const deleteFile = () => {
			index.handlers.onDeleteFiles({ files: [workspaceFile(path)] });
			mock.timers.tick(1000);
		};

		// Only the workspace half lists the file, so a lookup that falls back to vanilla cannot
		// mask a change to the workspace half.
		beforeEach(() => {
			world.list = (root, half) => (half === "workspace" && root === index.root ? listed([index.file]) : []);
			world.read = () => Buffer.from(index.content);
		});

		it("registers a disposable and does no build work for it", async () => {
			const disposable = index.register();
			try {
				await settle();
				assert.strictEqual(world.listings, 0);
				assert.strictEqual(typeof disposable.dispose, "function");
			} finally {
				disposable.dispose();
			}
		});

		for (const key of ["installPath", "loadDlcContents"]) {
			it(`refreshes global definitions when ${key} changes`, async () => {
				world.list = (root, half) => half === "global" && root === index.root ? listed([index.file]) : [];
				assert.deepStrictEqual(await index.lookup(), index.found);
				world.settings = { ...world.settings, [key]: key === "installPath" ? "/new/game" : true };
				world.list = () => [];
				index.handlers.onChangeConfiguration({
					affectsConfiguration: (setting: string) => setting === `mdHoi4Utilities.${key}`,
				});
				assert.deepStrictEqual(await index.lookup(), index.missing);
			});
		}

		it("does no build work when the feature flag is off", async () => {
			world.settings = { [index.flag]: false };
			refreshFeatureFlags();
			assert.deepStrictEqual(await index.lookup(), index.missing);
			assert.strictEqual(world.listings, 0);
		});

		it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async () => {
			const [first, second] = await Promise.all([index.lookup(), index.lookup()]);
			assert.deepStrictEqual([first, second], [index.found, index.found]);
			assert.strictEqual(world.listings, index.listingsPerBuild);

			assert.deepStrictEqual(await index.lookup(), index.found);
			assert.strictEqual(world.listings, index.listingsPerBuild);
		});

		it("ignores incremental events that arrive before any build has started", async () => {
			deleteFile();
			index.handlers.onCreateFiles({ files: [workspaceFile(path)] });
			mock.timers.tick(1000);
			await settle();
			assert.strictEqual(world.listings, 0);
			assert.strictEqual(world.reads, 0);

			assert.deepStrictEqual(await index.lookup(), index.found);
		});

		// If the delete ran at once it would be a no-op against the still-empty index, and the build's
		// later write would bring the entry back. Deferred, it runs after that write and removes it.
		it("defers an event that arrives while the build is pending, and applies it once the build settles", async () => {
			const read = deferred<Buffer>();
			world.read = () => read.promise;
			const lookup = index.lookup();
			await settle();

			deleteFile();
			read.resolve(Buffer.from(index.content));
			await lookup;
			await settle();

			assert.deepStrictEqual(await index.lookup(), index.missing);
		});

		it("applies an event after the debounce once the build has already settled", async () => {
			assert.deepStrictEqual(await index.lookup(), index.found);
			deleteFile();
			assert.deepStrictEqual(await index.lookup(), index.missing);
		});

		describe("filesystem notifications for unopened files", () => {
			let change: (file: vscode.Uri) => void;
			let create: (file: vscode.Uri) => void;
			let remove: (file: vscode.Uri) => void;
			let editorCreate: (event: vscode.FileCreateEvent) => void;
			let editorChange: (event: vscode.TextDocumentChangeEvent) => void;
			let editorClose: (document: vscode.TextDocument) => void;
			let editorDelete: (event: vscode.FileDeleteEvent) => void;
			let editorRename: (event: vscode.FileRenameEvent) => void;
			let registration: { dispose(): unknown };
			let watcherDisposed: boolean;
			const file = workspaceFile(path);

			beforeEach(() => {
				watcherDisposed = false;
				const disposable = () => ({ dispose() {} });
				mock.method(host().workspace, "createFileSystemWatcher", (pattern: vscode.GlobPattern) => {
					const globs: Record<string, string> = { ".gfx": ".[gG][fF][xX]", ".yml": ".[yY][mM][lL]", ".txt": ".[tT][xX][tT]" };
					assert.strictEqual(pattern, `**/*${globs[path.slice(path.lastIndexOf("."))]}`);
					return {
						onDidChange: (handler: typeof change) => { change = handler; return disposable(); },
						onDidCreate: (handler: typeof create) => { create = handler; return disposable(); },
						onDidDelete: (handler: typeof remove) => { remove = handler; return disposable(); },
						dispose: () => { watcherDisposed = true; },
					} as unknown as vscode.FileSystemWatcher;
				});
				mock.method(host().workspace, "onDidCreateFiles", (handler: typeof editorCreate) => { editorCreate = handler; return disposable(); });
				mock.method(host().workspace, "onDidChangeTextDocument", (handler: typeof editorChange) => { editorChange = handler; return disposable(); });
				mock.method(host().workspace, "onDidCloseTextDocument", (handler: typeof editorClose) => { editorClose = handler; return disposable(); });
				mock.method(host().workspace, "onDidDeleteFiles", (handler: typeof editorDelete) => { editorDelete = handler; return disposable(); });
				mock.method(host().workspace, "onDidRenameFiles", (handler: typeof editorRename) => { editorRename = handler; return disposable(); });
				registration = index.register();
				assert.deepStrictEqual(host().workspace.textDocuments, []);
			});

			afterEach(() => registration.dispose());

			it("updates one externally written file after the debounce without relisting the workspace", async () => {
				assert.deepStrictEqual(await index.lookup(), index.found);
				const reads = world.reads;
				world.read = () => Buffer.from("");
				change(file);
				mock.timers.tick(999);
				await settle();
				assert.strictEqual(world.reads, reads);
				mock.timers.tick(1);
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.missing);
				assert.strictEqual(world.reads, reads + 1);
				assert.strictEqual(world.listings, index.listingsPerBuild);
			});

			it("indexes external additions and removes external deletions", async () => {
				world.list = () => [];
				assert.deepStrictEqual(await index.lookup(), index.missing);
				create(file);
				mock.timers.tick(1000);
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.found);
				remove(file);
				mock.timers.tick(1000);
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.missing);
				assert.strictEqual(world.listings, index.listingsPerBuild);
				assert.strictEqual(world.reads, 1);
			});

			for (const casing of ["uppercase", "mixed case"]) {
				it(`updates ${casing} extensions through filesystem and editor subscriptions`, async () => {
					const extensionOffset = path.lastIndexOf(".");
					const extension = path.slice(extensionOffset);
					const changedExtension = casing === "uppercase" ? extension.toUpperCase() :
						extension.replace(/[a-z]/g, (letter, offset: number) => offset % 2 ? letter.toUpperCase() : letter);
					const mixedPath = path.slice(0, extensionOffset) + changedExtension;
					const mixedFile = workspaceFile(mixedPath);
					const found = index.found === path ? mixedPath :
						Array.isArray(index.found) ? index.found.map((value: string) => value === path ? mixedPath : value) : index.found;
					world.list = () => [];
					assert.deepStrictEqual(await index.lookup(), index.missing);
					const flush = async (expected: unknown) => {
						mock.timers.tick(1000);
						await settle();
						assert.deepStrictEqual(await index.lookup(), expected);
					};

					create(mixedFile);
					await flush(found);
					world.read = () => Buffer.from("");
					change(mixedFile);
					await flush(index.missing);
					world.read = () => Buffer.from(index.content);
					editorCreate({ files: [mixedFile] });
					await flush(found);
					world.read = () => Buffer.from("");
					editorChange({ document: { uri: mixedFile } } as vscode.TextDocumentChangeEvent);
					await flush(index.missing);
					world.read = () => Buffer.from(index.content);
					editorClose({ uri: mixedFile, isDirty: true } as vscode.TextDocument);
					await flush(found);
					editorDelete({ files: [mixedFile] });
					await flush(index.missing);
					editorRename({ files: [{ oldUri: mixedFile, newUri: mixedFile }] });
					await flush(found);
					remove(mixedFile);
					await flush(index.missing);
					assert.strictEqual(world.listings, index.listingsPerBuild);
					assert.strictEqual(world.reads, 6);
				});
			}

			it("coalesces filesystem and editor notifications for the same write", async () => {
				await index.lookup();
				const reads = world.reads;
				create(file);
				editorCreate({ files: [file] });
				change(file);
				editorChange({ document: { uri: file } } as vscode.TextDocumentChangeEvent);
				mock.timers.tick(1000);
				await settle();
				assert.strictEqual(world.reads, reads + 1);
				assert.strictEqual(world.listings, index.listingsPerBuild);
			});

			it("keeps the last operation when an external replacement is reported as delete then create", async () => {
				await index.lookup();
				remove(file);
				create(file);
				mock.timers.tick(1000);
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.found);
			});

			it("cancels a queued write when the file is then deleted", async () => {
				await index.lookup();
				const reads = world.reads;
				change(file);
				remove(file);
				mock.timers.tick(1000);
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.missing);
				assert.strictEqual(world.reads, reads);
			});

			it("does not resurrect a deleted file when its earlier read finishes later", async () => {
				await index.lookup();
				const read = deferred<Buffer>();
				world.read = () => read.promise;
				change(file);
				mock.timers.tick(1000);
				await settle();
				remove(file);
				mock.timers.tick(1000);
				await settle();
				read.resolve(Buffer.from(index.content));
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.missing);
			});

			it("does not let an older read overwrite a later update", async () => {
				await index.lookup();
				const read = deferred<Buffer>();
				world.read = () => read.promise;
				change(file);
				mock.timers.tick(1000);
				await settle();
				world.read = () => Buffer.from("");
				change(file);
				mock.timers.tick(1000);
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.missing);
				read.resolve(Buffer.from(index.content));
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.missing);
			});

			it("discards an in-flight re-read after disposal", async () => {
				await index.lookup();
				const read = deferred<Buffer>();
				world.read = () => read.promise;
				change(file);
				mock.timers.tick(1000);
				await settle();
				registration.dispose();
				read.resolve(Buffer.from(""));
				await settle();
				assert.deepStrictEqual(await index.lookup(), index.found);
			});

			it("bounds a continuous stream of writes to three seconds", async () => {
				await index.lookup();
				const reads = world.reads;
				for (let i = 0; i < 6; i++) {
					change(file);
					mock.timers.tick(500);
				}
				await settle();
				assert.strictEqual(world.reads, reads + 1);
			});

			it("ignores notifications before first use and outside the index roots", async () => {
				change(file);
				create(file);
				remove(file);
				mock.timers.tick(1000);
				await settle();
				assert.strictEqual(world.reads, 0);
				assert.strictEqual(world.listings, 0);
				await index.lookup();
				const reads = world.reads;
				change(workspaceFile(`unrelated/${index.file}`));
				mock.timers.tick(1000);
				await settle();
				assert.strictEqual(world.reads, reads);
			});

			it("disposes the watcher and cancels pending timers and later callbacks", async () => {
				await index.lookup();
				const reads = world.reads;
				change(file);
				registration.dispose();
				assert.strictEqual(watcherDisposed, true);
				change(file);
				create(file);
				remove(file);
				mock.timers.tick(3000);
				await settle();
				assert.strictEqual(world.reads, reads);
				assert.deepStrictEqual(await index.lookup(), index.found);
			});

			it("cancels mutations waiting for an initial build when disposed", async () => {
				const read = deferred<Buffer>();
				world.read = () => read.promise;
				const lookup = index.lookup();
				await settle();
				change(file);
				mock.timers.tick(1000);
				const reads = world.reads;
				registration.dispose();
				read.resolve(Buffer.from(index.content));
				await lookup;
				await settle();
				assert.strictEqual(world.reads, reads);
			});
		});

	});
}
