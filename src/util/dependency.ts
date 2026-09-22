import * as vscode from "vscode";
import { Commands, ContextName } from "../constants";
import { sendEvent } from "./telemetry";
import { localize } from "./i18n";
import { contextContainer } from "../context";
import { error } from "./debug";
import {
	getHoiOpenedFileOriginalUri,
	listFilesFromModOrHOI4,
	readFileFromModOrHOI4,
} from "./fileloader";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getEvents, HOIEvents, HOIEvent } from "../previewdef/event/schema";
import {
	getLanguageIdInYml,
	getRelativePathInWorkspace,
	isSameUri,
} from "./vsccommon";
import { flatMap, flatten } from "lodash";
import { parseYaml } from "./yaml";
import { indexParseQueue } from "./indexBuild";
import {
	noProgress,
	ProgressReport,
	withCancellableProgress,
} from "./progress";
import { Logger } from "./logger";

export type Dependency = { type: string; path: string };

export function getDependenciesFromText(text: string): Dependency[] {
	const dependencies: Dependency[] = [];
	const regex = /^\s*#!(?<type>.*?):(?<path>.*\.(?<ext>.*?))$/gm;
	let match = regex.exec(text);
	while (match) {
		const type = match.groups?.type;
		const ext = match.groups?.ext!;
		if (type && (type === ext || ext === "txt" || ext === "yml")) {
			const path = match.groups?.path!;
			const pathValue = path.trim().replace(/\/\/+|\\+/g, "/");

			dependencies.push({ type, path: pathValue });
		}

		match = regex.exec(text);
	}

	return dependencies;
}

export function registerScanReferencesCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(
		Commands.ScanReferences,
		scanReferences,
	);
}

async function scanReferences(): Promise<void> {
	sendEvent("scanReferences");

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showErrorMessage(
			localize("scanref.noeditor", "No opened editor."),
		);
		return;
	}

	try {
		if (
			contextContainer.contextValue[ContextName.Hoi4PreviewType] === "event"
		) {
			const result = await withCancellableProgress(
				localize("scanref.progress", "Scanning references"),
				(progress) => scanReferencesForEvents(editor, progress),
			);
			// A cancel says nothing: the user pressed Cancel and already knows.
			if (result === "done") {
				void vscode.window.showInformationMessage(
					localize("scanref.done", "Scan reference done."),
				);
			}
		} else {
			void vscode.window.showErrorMessage(
				localize(
					"scanref.unsupportedtype",
					"Unsupported file type to scan references.",
				),
			);
		}
	} catch (e) {
		error(e);
		void vscode.window.showErrorMessage(
			localize("scanref.failed", "Scan references failed: {0}", `${e}`),
		);
	}
}

/**
 * Loads `files` through the shared index parse queue, so a scan over a mod's whole `events/` or
 * `localisation/` folder holds a handful of buffers at a time rather than all of them at once.
 * A file whose `load` throws is logged and dropped; `undefined` results are dropped quietly.
 */
export async function loadBounded<T>(
	files: string[],
	load: (file: string) => Promise<T | undefined>,
): Promise<T[]> {
	const loaded = await indexParseQueue.map(files, async (file) => {
		try {
			return await load(file);
		} catch (e) {
			Logger.warn(`[ScanReferences] can't read ${file}: ${e}`);
			return undefined;
		}
	});
	return loaded.filter((e): e is T => e !== undefined);
}

function childIdsOf(event: HOIEvent): string[] {
	return flatMap([event.immediate, ...event.options], (o) => o.childEvents).map(
		(ce) => ce.eventName,
	);
}

/**
 * Walks the event graph both ways from `mainEvents` -- the events they fire, the events that fire
 * them, and so on -- and reports the files those events live in. Every event is visited once and
 * every link followed once, which is what keeps a mod with thousands of events off the host thread
 * for seconds rather than minutes.
 */
export function collectLinkedEvents(
	mainEvents: HOIEvent[],
	eventItems: HOIEvent[],
): { includedEventFiles: string[]; searchedEvents: HOIEvent[] } {
	const childrenById = new Map<string, string[]>();
	const eventsById = new Map<string, HOIEvent[]>();
	const parentsById = new Map<string, HOIEvent[]>();
	for (const event of eventItems) {
		const children = childIdsOf(event);
		childrenById.set(event.id, children);
		pushTo(eventsById, event.id, event);
		for (const childId of children) {
			pushTo(parentsById, childId, event);
		}
	}
	for (const event of mainEvents) {
		childrenById.set(event.id, childIdsOf(event));
	}

	const searched = new Set<string>(mainEvents.map((e) => e.id));
	const includedFileSet = new Set<string>();
	const includedEventFiles: string[] = [];
	const searchingEvents: HOIEvent[] = [...mainEvents];
	const searchedEvents: HOIEvent[] = [];

	const reach = (ei: HOIEvent) => {
		searchingEvents.push(ei);
		if (!includedFileSet.has(ei.file)) {
			includedFileSet.add(ei.file);
			includedEventFiles.push(ei.file);
		}
	};

	while (searchingEvents.length > 0) {
		const event = searchingEvents.pop()!;
		for (const childId of childrenById.get(event.id) ?? []) {
			if (searched.has(childId)) {
				continue;
			}
			searched.add(childId);
			// Two files can define the same id; each one is included, the way the old scan did.
			(eventsById.get(childId) ?? []).forEach(reach);
		}
		for (const parent of parentsById.get(event.id) ?? []) {
			if (!searched.has(parent.id)) {
				searched.add(parent.id);
				reach(parent);
			}
		}
		searchedEvents.push(event);
	}

	return { includedEventFiles, searchedEvents };
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list === undefined) {
		map.set(key, [value]);
	} else {
		list.push(value);
	}
}

/** The localisation keys a set of events shows: each title and each option name. */
export function localisationKeysOf(events: HOIEvent[]): Set<string> {
	const keys = new Set<string>();
	for (const event of events) {
		if (event.title) {
			keys.add(event.title);
		}
		for (const option of event.options) {
			if (option.name) {
				keys.add(option.name);
			}
		}
	}
	return keys;
}

export async function scanReferencesForEvents(
	editor: vscode.TextEditor,
	progress: ProgressReport = noProgress,
): Promise<"done" | "cancelled"> {
	const eventFiles = await listFilesFromModOrHOI4("events");
	const document = editor.document;
	// One counter across both passes: two bars for one action reads as two actions.
	let total = eventFiles.length;
	let done = 0;
	const events = await loadBounded<HOIEvents>(eventFiles, async (file) => {
		if (progress.token.isCancellationRequested || document.isClosed) {
			return undefined;
		}
		const filePath = "events/" + file;
		const [buffer, realPath] = await readFileFromModOrHOI4(filePath);
		const realPathUri = getHoiOpenedFileOriginalUri(realPath);
		if (isSameUri(document.uri, realPathUri)) {
			return undefined;
		}
		const parsed = getEvents(parseHoi4File(buffer.toString()), filePath);
		progress.report(++done, total);
		return parsed;
	});

	if (document.isClosed || progress.token.isCancellationRequested) {
		return "cancelled";
	}

	const eventItems = flatMap(events, (e) =>
		flatten(Object.values(e.eventItemsByNamespace)),
	);

	const relativePath = getRelativePathInWorkspace(document.uri);
	const content = document.getText();
	const mainEvents = flatten(
		Object.values(
			getEvents(parseHoi4File(content), relativePath).eventItemsByNamespace,
		),
	);

	const { includedEventFiles, searchedEvents } = collectLinkedEvents(
		mainEvents,
		eventItems,
	);

	if (document.isClosed || progress.token.isCancellationRequested) {
		return "cancelled";
	}

	const existingDependency = getDependenciesFromText(document.getText());
	const existingEventDependency = existingDependency
		.filter((d) => d.type === "event")
		.map((d) => d.path.replace(/\\+/g, "/"));
	existingEventDependency.push(relativePath);
	const moreEventDependencyContent = includedEventFiles
		.filter((f) => !existingEventDependency.includes(f))
		.map((f) => `#!event:${f}\n`)
		.join("");

	const existingLocalizationDependency = new Set(
		existingDependency
			.filter((d) => d.type.match(/^locali[zs]ation$/))
			.map((d) => d.path.replace(/\\+/g, "/")),
	);
	const wantedKeys = localisationKeysOf(searchedEvents);
	const language = getLanguageIdInYml();
	const localizationFiles = (await listFilesFromModOrHOI4("localisation"))
		.map((file) => "localisation/" + file)
		.filter((filePath) => !existingLocalizationDependency.has(filePath));
	total += localizationFiles.length;
	// Only the file name comes back: the parsed yml is checked against the wanted keys inside
	// the callback and dropped, so no more than the queue's worth of them is ever alive.
	const localizations = await loadBounded<string>(
		localizationFiles,
		async (filePath) => {
			if (progress.token.isCancellationRequested || document.isClosed) {
				return undefined;
			}
			progress.report(++done, total);
			const [buffer, realPath] = await readFileFromModOrHOI4(filePath);
			const realPathUri = getHoiOpenedFileOriginalUri(realPath);
			if (isSameUri(document.uri, realPathUri)) {
				return undefined;
			}
			const result: unknown = parseYaml(buffer.toString());
			if (typeof result !== "object" || result === null) {
				return undefined;
			}
			const section = (result as Record<string, unknown>)[language];
			if (typeof section !== "object" || section === null || Array.isArray(section)) {
				return undefined;
			}
			for (const key of wantedKeys) {
				if (key in section) {
					return filePath;
				}
			}
			return undefined;
		},
	);

	const moreLocalizationDependencyContent = localizations
		.map((lf) => `#!localisation:${lf}\n`)
		.join("");

	// Checked once more here so a cancel in the last moment does not still write to the file.
	if (document.isClosed || progress.token.isCancellationRequested) {
		return "cancelled";
	}

	await editor.edit((eb) => {
		eb.insert(
			new vscode.Position(0, 0),
			moreEventDependencyContent + moreLocalizationDependencyContent,
		);
	});

	return "done";
}
