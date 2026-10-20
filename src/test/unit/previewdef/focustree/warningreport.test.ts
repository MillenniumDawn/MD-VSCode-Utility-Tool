import * as assert from "assert";
import { mock } from "node:test";
import { posix } from "path";
import * as hoiparser from "../../../../hoiformat/hoiparser";
import * as schema from "../../../../previewdef/focustree/schema";
import {
	auditFocusTrees,
	collectFocusWarnings,
	collectFocusWarningsAsync,
	FileWarnings,
	ParsedFocusFile,
} from "../../../../previewdef/focustree/warningreport";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { clearDlcZipCache } from "../../../../util/fileloader";
import { handOver } from "../../host";

function parsed(path: string, text: string): ParsedFocusFile {
	return { path, file: schema.convertFocusFileNodeToJson(hoiparser.parseHoi4File(text), {}) };
}
function configure(useConditionInFocus: boolean): void {
	handOver({ workspace: { getConfiguration: () => ({ useConditionInFocus }) } });
	refreshFeatureFlags();
}
const donor = () => parsed("donor.txt", "shared_focus = { id = a x = 0 y = 0 } shared_focus = { id = b x = 0 y = 0 }");
const importer = () =>
	parsed("host.txt", "focus_tree = { id = country shared_focus = a shared_focus = b focus = { id = c x = 1 y = 0 } }");
const plain = (name: string) => parsed(`${name}.txt`, `focus_tree = { id = ${name} focus = { id = ${name}_focus x = 0 y = 0 } }`);
const files = () => [donor(), importer()];

// Donors, importers, a local-only tree, a duplicate donor, a cycle and gated branches, none of
// them missing an id: a missing id gets a random one, which would differ between two collections.
const mixed = () => [
	parsed("mixed.txt", `
shared_focus = { id = own x = 0 y = 0 }
joint_focus = { id = anchor x = 2 y = 1 }
focus_tree = { id = importing shared_focus = own shared_focus = external shared_focus = missing
 focus = { id = local x = 0 y = 0 }
 focus = { id = local x = 1 y = 0 }
 focus = { id = "" x = 1 y = 0 }
}
focus_tree = { id = local_only focus = { id = a x = 0 y = 0 } focus = { id = b x = 0 y = 0 } }
`),
	parsed("external.txt", `shared_focus = { id = external x = 0 y = 0 }
shared_focus = { id = child prerequisite = { focus = external } relative_position_id = external x = 0 y = 0 }
`),
	parsed("duplicate-donor.txt", "shared_focus = { id = external x = 20 y = 20 }"),
	parsed("other.txt", `focus_tree = { id = other shared_focus = external
 focus = { id = first x = 0 y = 0 relative_position_id = second }
 focus = { id = second x = 0 y = 0 relative_position_id = first }
 focus = { id = gated x = 0 y = 0 allow_branch = { has_country_flag = path_a } }
 focus = { id = othergate x = 0 y = 0 allow_branch = { NOT = { has_country_flag = path_a } } }
}`),
];

// Every file is built once without donors, and the files that import shared focuses are built
// again with them: the collection before the first pass skipped the trees it was about to rebuild.
function unskippedWarnings(input: ParsedFocusFile[], useConditionInFocus: boolean): FileWarnings[] {
	const build = (file: ParsedFocusFile["file"], donors: schema.FocusTree[], path: string) =>
		schema.getFocusTreeWithFocusFile(file, donors, path, {}, useConditionInFocus);
	const treesByFile = new Map(input.map(({ path, file }) => [path, build(file, [], path)]));
	if (useConditionInFocus) {
		const shared = [...treesByFile].flatMap(([path, trees]) =>
			trees.filter((tree) => tree.isSharedFocues).map((tree) => ({ path, tree })),
		);
		for (const { path, file } of input) {
			if (file.focus_tree.some((tree) => schema.extractOrListIds(tree.shared_focus).length > 0)) {
				const donors = shared.filter((s) => s.path !== path).map((s) => s.tree);
				treesByFile.set(path, build(file, donors, path));
			}
		}
	}
	const listed = new Map<string, FileWarnings>();
	const seen = new Set<string>();
	for (const ownTreesOnly of [true, false]) {
		for (const [path, trees] of treesByFile) {
			for (const tree of trees) {
				for (const { source, text } of tree.warnings) {
					const definedIn = tree.focuses[source]?.file ?? path;
					const key = JSON.stringify([definedIn, source, text]);
					if ((definedIn === path) === ownTreesOnly && !seen.has(key)) {
						seen.add(key);
						const file = listed.get(definedIn) ?? { file: definedIn, warnings: [] };
						file.warnings.push({ treeId: tree.id, source, text });
						listed.set(definedIn, file);
					}
				}
			}
		}
	}
	return [...listed.values()];
}

describe("focus audit collection", () => {
	let now: typeof Date.now;
	beforeEach(() => { now = Date.now; configure(true); });
	afterEach(() => { Date.now = now; mock.restoreAll(); });

	// Every time slice is over by the time it is checked, so the collection yields after each step.
	function sliceEveryStep(): void {
		let clock = 0;
		Date.now = () => (clock += 9);
	}

	for (const enabled of [true, false]) {
		it(`lists what a collection that skips nothing lists, with conditions ${enabled}`, async () => {
			configure(enabled);
			const input = mixed();
			const expected = unskippedWarnings(input, enabled);
			assert.ok(expected.some((file) => file.warnings.length > 0));
			assert.deepStrictEqual(await collectFocusWarningsAsync(input), expected);
		});
	}

	for (const [enabled, expected] of [
		// [file, trees in the file it was built from, donors it was given]
		[true, [["donor.txt", 0, 0], ["host.txt", 0, 0], ["plain.txt", 1, 0], ["host.txt", 1, 1]]],
		[false, [["donor.txt", 0, 0], ["host.txt", 1, 0], ["plain.txt", 1, 0]]],
	] as const) {
		it(`gives an importer no first pass over its own trees, with conditions ${enabled}`, async () => {
			configure(enabled);
			const input = [...files(), plain("plain")];
			const build = mock.method(schema, "getFocusTreeWithFocusFile");
			await collectFocusWarningsAsync(input);
			assert.deepStrictEqual(
				build.mock.calls.map(({ arguments: [file, donors, path] }) => [path, file.focus_tree.length, donors.length]),
				expected,
			);
		});
	}

	it("keeps the captured condition setting across yields", async () => {
		sliceEveryStep();
		const input = files();
		const expected = collectFocusWarnings(input);
		configure(false);
		assert.notDeepStrictEqual(collectFocusWarnings(input), expected);
		configure(true);
		setImmediate(() => configure(false));
		assert.deepStrictEqual(await collectFocusWarningsAsync(input), expected);
	});

	it("does not start a cancelled collection", async () => {
		const input = files();
		Object.defineProperty(input[0], "file", { get: () => { throw new Error("must not read"); } });
		assert.strictEqual(await collectFocusWarningsAsync(input, { isCancellationRequested: true }), undefined);
	});

	for (const turns of [1, 2, 3]) {
		it(`stops building trees when cancelled during event-loop turn ${turns}`, async () => {
			sliceEveryStep();
			const input = ["a", "b", "c", "d", "e"].map(plain);
			const build = mock.method(schema, "getFocusTreeWithFocusFile");
			const token = { isCancellationRequested: false };
			const cancelAfter = (left: number): void => {
				setImmediate(() => {
					if (left === 1) { token.isCancellationRequested = true; }
					else { cancelAfter(left - 1); }
				});
			};
			cancelAfter(turns);
			assert.strictEqual(await collectFocusWarningsAsync(input, token), undefined);
			assert.strictEqual(build.mock.callCount(), turns);
		});
	}

	it("services cancellation before returning even an empty report", async () => {
		const token = { isCancellationRequested: false };
		setImmediate(() => { token.isCancellationRequested = true; });
		assert.strictEqual(await collectFocusWarningsAsync([], token), undefined);
	});
});

const focusFolder = "/mod/common/national_focus";

class FakeUri {
	readonly scheme = "file";
	constructor(readonly path: string, readonly fragment = "") {}
	get fsPath(): string { return this.path; }
	with(change: { fragment?: string }): FakeUri { return new FakeUri(this.path, change.fragment ?? this.fragment); }
	toString(): string { return `file://${this.path}${this.fragment === "" ? "" : `#${this.fragment}`}`; }
}

// An editor whose only workspace folder holds the given focus files. `onListing` and `onRead` run
// as the folder is listed and as each file is read, which is where a test cancels.
function openWorkspace(texts: Record<string, string>) {
	const state = {
		token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
		reads: 0,
		opened: [] as string[],
		shown: 0,
		errors: [] as string[],
		onListing: () => {},
		onRead: () => {},
	};
	handOver({
		ProgressLocation: { Notification: 15 },
		FileType: { File: 1, Directory: 2 },
		Uri: {
			file: (path: string) => new FakeUri(path),
			parse: (text: string) => {
				const [path = "", fragment] = text.replace("file://", "").split("#");
				return new FakeUri(path, fragment);
			},
			joinPath: (base: FakeUri, ...parts: string[]) => new FakeUri(posix.join(base.path, ...parts)),
		},
		workspace: {
			workspaceFolders: [{ uri: new FakeUri("/mod") }],
			textDocuments: [],
			getConfiguration: () => ({ useConditionInFocus: true, modFile: "", get: <T>() => undefined as T }),
			fs: {
				stat: async (uri: FakeUri) => {
					if (uri.path === focusFolder) { return { type: 2, mtime: 1 }; }
					if (posix.dirname(uri.path) === focusFolder && posix.basename(uri.path) in texts) { return { type: 1, mtime: 1 }; }
					throw new Error("ENOENT");
				},
				readDirectory: async (uri: FakeUri) => {
					if (uri.path !== focusFolder) { return []; }
					state.onListing();
					return Object.keys(texts).map((name) => [name, 1]);
				},
				readFile: async (uri: FakeUri) => {
					state.reads++;
					state.onRead();
					return Buffer.from(texts[posix.basename(uri.path)] ?? "");
				},
			},
			openTextDocument: async ({ content }: { content: string }) => { state.opened.push(content); return {} as never; },
		},
		window: {
			withProgress: async (_options: unknown, callback: (progress: unknown, token: unknown) => unknown) =>
				callback({ report() {} }, state.token),
			showTextDocument: async () => { state.shown++; return {} as never; },
			showErrorMessage: async (message: string) => { state.errors.push(message); return undefined; },
		},
	});
	refreshFeatureFlags();
	return state;
}

describe("focus audit command", () => {
	const texts = {
		"a.txt": "focus_tree = { id = a focus = { id = x x = 0 y = 0 } }",
		"b.txt": "focus_tree = { id = b focus = { id = y x = 0 y = 0 } }",
	};
	beforeEach(clearDlcZipCache);
	afterEach(() => mock.restoreAll());

	it("shows a report of the files it read, parsed without source tokens", async () => {
		const state = openWorkspace(texts);
		const parse = mock.method(hoiparser, "parseHoi4File");
		await auditFocusTrees();
		assert.strictEqual(state.reads, 2);
		assert.match(state.opened.join(), /Checked 2 focus tree files/);
		assert.strictEqual(state.shown, 1);
		assert.deepStrictEqual(state.errors, []);
		assert.deepStrictEqual(parse.mock.calls.map((call) => call.arguments[2]), [{ keepTokens: false }, { keepTokens: false }]);
	});

	it("reads nothing when cancelled while the folder is listed", async () => {
		const state = openWorkspace(texts);
		state.onListing = () => { state.token.isCancellationRequested = true; };
		await auditFocusTrees();
		assert.strictEqual(state.reads, 0);
		assert.deepStrictEqual([state.opened, state.shown, state.errors], [[], 0, []]);
	});

	it("parses nothing when cancelled while the files are read", async () => {
		const state = openWorkspace(texts);
		state.onRead = () => { state.token.isCancellationRequested = true; };
		const parse = mock.method(hoiparser, "parseHoi4File");
		await auditFocusTrees();
		assert.ok(state.reads > 0);
		assert.strictEqual(parse.mock.callCount(), 0);
		assert.deepStrictEqual([state.opened, state.shown, state.errors], [[], 0, []]);
	});

	it("publishes nothing when cancelled during the last step of the collection", async () => {
		const state = openWorkspace({ "a.txt": texts["a.txt"] });
		const build = schema.getFocusTreeWithFocusFile;
		mock.method(schema, "getFocusTreeWithFocusFile", (...args: Parameters<typeof build>) => {
			setImmediate(() => { state.token.isCancellationRequested = true; });
			return build(...args);
		});
		await auditFocusTrees();
		assert.deepStrictEqual([state.opened, state.shown, state.errors], [[], 0, []]);
	});
});
