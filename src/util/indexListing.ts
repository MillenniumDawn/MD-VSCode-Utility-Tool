import * as vscode from "vscode";
import { CancelledError } from "./common";
import {
	getFilePathFromModOrHOI4,
	listFileEntriesFromModOrHOI4,
	ListFileEntriesOptions,
	ModOrHoi4FileEntry,
} from "./fileloader";
import { getFileMtimes } from "./indexCache";
import { Logger } from "./logger";

/*
 * What the four index builds ask the filesystem for, in one place.
 *
 * Each of them used to do this in two passes: list the names under a folder, then walk that list
 * resolving every name back to a path and stat'ing it. The second pass was the expensive one -- for
 * the vanilla half it stat'd the install path and every DLC folder, per file, through a filesystem
 * provider that answers by calling vscode.workspace.fs again -- and it was asking for something the
 * listing had already been holding. Now the listing hands back names, URIs and mtimes together, and
 * the second pass only runs for files a listing could not date: the web build, a remote install path,
 * or a file deleted between the walk and its stat.
 */

export interface IndexListingSpec {
	/** The folders to list, in the order their files should appear. */
	roots: string[];
	/** Applied to the name relative to its root, before the `${root}/` prefix goes on. */
	filter?: (relativePath: string) => boolean;
	/** Which sources to look in. Passed through as-is; a missing key is not the same as `false`. */
	options: ListFileEntriesOptions;
	/** Treat a root that cannot be listed as an empty one, rather than failing the whole build. */
	tolerateRootErrors?: boolean;
}

export interface IndexListing {
	/** `${root}/${name}` for every file that passed the filter, roots in the order given. */
	filePaths: string[];
	/** Where each of those files is, for the parse phase to read without resolving it again. */
	uris: Map<string, vscode.Uri>;
	/**
	 * When each was last written. A file whose mtime could not be determined is absent rather than
	 * zero, which is what getFileMtimes has always done and what computeStaleFiles reads as "gone".
	 */
	mtimes: Map<string, number>;
}

/** A file the parse phase is about to read, with the URI its listing resolved, where there was one. */
export interface IndexFile {
	path: string;
	uri?: vscode.Uri;
}

export function toIndexFiles(
	paths: string[],
	uris: Map<string, vscode.Uri>,
): IndexFile[] {
	return paths.map((path) => ({ path, uri: uris.get(path) }));
}

export async function listIndexFiles(
	spec: IndexListingSpec,
): Promise<IndexListing> {
	const { roots, filter, options } = spec;
	const tolerateRootErrors = spec.tolerateRootErrors === true;

	const perRoot = await Promise.all(
		roots.map((root) => listRoot(root, options, tolerateRootErrors)),
	);

	const filePaths: string[] = [];
	const uris = new Map<string, vscode.Uri>();
	const mtimes = new Map<string, number>();
	const undated: string[] = [];

	for (let i = 0; i < roots.length; i++) {
		const root = roots[i]!;
		for (const entry of perRoot[i]!) {
			if (filter && !filter(entry.relativePath)) {
				continue;
			}

			const filePath = `${root}/${entry.relativePath}`;
			filePaths.push(filePath);
			uris.set(filePath, entry.uri);
			if (entry.mtime === undefined) {
				undated.push(filePath);
			} else {
				mtimes.set(filePath, entry.mtime);
			}
		}
	}

	if (undated.length > 0) {
		// The slow path, and on a desktop install it does not run at all: resolve and stat each of
		// these the way every build used to do for every file it listed.
		const resolveOptions = { mod: options.mod, hoi4: options.hoi4 };
		const resolved = await getFileMtimes(undated, (relativePath) =>
			getFilePathFromModOrHOI4(relativePath, resolveOptions),
		);
		for (const [filePath, mtime] of resolved) {
			mtimes.set(filePath, mtime);
		}
	}

	return { filePaths, uris, mtimes };
}

async function listRoot(
	root: string,
	options: ListFileEntriesOptions,
	tolerateErrors: boolean,
): Promise<ModOrHoi4FileEntry[]> {
	if (!tolerateErrors) {
		return await listFileEntriesFromModOrHOI4(root, options);
	}

	try {
		return await listFileEntriesFromModOrHOI4(root, options);
	} catch (cause) {
		// A root a mod simply does not have is ordinary. A cancellation is not: swallowing it would
		// leave the build to finish against an empty listing and write that emptiness to the cache.
		if (cause instanceof CancelledError) {
			throw cause;
		}
		Logger.warn(`Index listing: skipping ${root}: ${cause}`);
		return [];
	}
}
