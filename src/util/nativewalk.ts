import * as path from "path";
import { CancellationLike, mapLimit, throwIfCancelled } from "./common";

/*
 * A directory walk on node's own filesystem API, for roots that are really on disk.
 *
 * Everything else in the extension lists directories through `vscode.workspace.fs`, which is the
 * right default: it is the only thing that works on the web build and over a remote workspace. It is
 * also an RPC per directory, and for anything under the HOI4 install path it is *two* -- the
 * `hoi4installpath:` FileSystemProvider lives in the extension host and answers by calling
 * `vscode.workspace.fs` again. An index build over a mod the size of Millennium Dawn walks nearly
 * four thousand files, so the difference between a syscall and a round trip is the difference
 * between a fifth of a second and minutes.
 *
 * This module is node-only. It is loaded through `require` from inside an `if (!IS_WEB_EXT)` block so
 * webpack's DefinePlugin drops the branch and never tries to resolve `node:fs/promises` for the web
 * bundle, which has no `fs` at all.
 */

const fs = require("node:fs/promises") as typeof import("node:fs/promises");

export interface NativeWalkEntry {
	/** Path relative to the walk root, `/`-separated, matching what readDirFilesRecursively returns. */
	relativePath: string;
	fsPath: string;
	/** Milliseconds, whole, so it compares equal to a `vscode.FileStat.mtime` for the same file. */
	mtime: number;
}

export interface NativeWalkOptions {
	recursively?: boolean;
	maxDepth?: number;
	token?: CancellationLike;
	/** Where a skipped directory is reported. Nothing here fails a walk; a lost folder is logged. */
	onWarning?: (message: string) => void;
}

/**
 * Deeper than any real HOI4 or mod tree comes close to -- the deepest vanilla path is about six --
 * and shallow enough that a tree which somehow escapes the cycle guard still terminates.
 */
export const MAX_WALK_DEPTH = 32;

/**
 * Pure syscalls on libuv's threadpool, so past a small multiple of the pool size more concurrency
 * only lengthens the queue. The same order as indexCache's MTIME_BATCH_SIZE of 30, which is what this
 * replaces, so it is not a step change in how hard the disk is being asked to work.
 */
const STAT_CONCURRENCY = 32;

/**
 * Every file under `rootFsPath`, with its mtime, from one traversal. `readdir` cannot report mtimes,
 * so this is one `readdir` per directory plus one `stat` per file -- what it removes is the *second*
 * pass that resolved every listed name back to a path and stat'd it again.
 *
 * Throws if `rootFsPath` is not a readable directory, which is how the caller learns to fall back to
 * `vscode.workspace.fs` for a path that is not really on disk. Throws `CancelledError` if the token
 * is cancelled: a partial listing is worse than none, because whoever asked would write it to a cache
 * manifest and record every file it never reached as deleted.
 */
export async function walkFilesWithMtime(
	rootFsPath: string,
	options?: NativeWalkOptions,
): Promise<NativeWalkEntry[]> {
	const recursively = options?.recursively ?? false;
	const maxDepth = options?.maxDepth ?? MAX_WALK_DEPTH;
	const token = options?.token;
	const warn = options?.onWarning;

	const found: { relativePath: string; fsPath: string }[] = [];
	const visitedDirectories = new Set<string>();
	let warnedAboutDepth = false;
	let warnedAboutCycle = false;

	throwIfCancelled(token);
	// Not swallowed, unlike the guard on every directory below it: a root that is not on disk is the
	// signal the caller needs, not an empty folder.
	visitedDirectories.add(normalizeRealPath(await fs.realpath(rootFsPath)));
	await readDirectoryInto(rootFsPath, "", 0);

	const entries = await mapLimit(found, STAT_CONCURRENCY, async (file) => {
		throwIfCancelled(token);
		try {
			const stat = await fs.stat(file.fsPath);
			return {
				relativePath: file.relativePath,
				fsPath: file.fsPath,
				// mtime.getTime(), never mtimeMs. vscode's FileStat.mtime is a whole number of
				// milliseconds and staleness is decided with !==, so the sub-millisecond fraction
				// mtimeMs carries on some platforms would make every file look changed the first time
				// a cache written from one source was read against the other.
				mtime: stat.mtime.getTime(),
			};
		} catch {
			// Deleted or locked between the listing and the stat. Leaving it out is what getFileMtimes
			// does with a file it cannot stat, and callers already read an absent mtime as "gone".
			return null;
		}
	});

	return entries.filter((entry): entry is NativeWalkEntry => entry !== null);

	async function readDirectoryInto(
		dirFsPath: string,
		prefix: string,
		depth: number,
	): Promise<void> {
		throwIfCancelled(token);

		let dirents;
		try {
			dirents = await fs.readdir(dirFsPath, { withFileTypes: true });
		} catch (e) {
			warn?.(`Failed to read directory ${dirFsPath}: ${e}`);
			return;
		}

		const subdirectories: string[] = [];
		for (const dirent of dirents) {
			const childFsPath = path.join(dirFsPath, dirent.name);
			let isDirectory = dirent.isDirectory();
			let isFile = dirent.isFile();

			if (dirent.isSymbolicLink()) {
				// A Dirent describes the link, not what it points at, so a symlinked file answers false
				// to both isFile() and isDirectory(). The vscode.workspace.fs walk drops those silently
				// -- its FileType comes back as File|SymbolicLink, which matches neither of the two
				// values it tests for -- which means a mod folder reached through a junction, the usual
				// arrangement on Windows, is invisible to every index. Follow them instead; the cycle
				// guard below is what makes that safe.
				const target = await statOrUndefined(childFsPath);
				if (target === undefined) {
					continue; // broken link
				}
				isDirectory = target.isDirectory();
				isFile = target.isFile();
			}

			if (isFile) {
				found.push({
					relativePath: prefix + dirent.name,
					fsPath: childFsPath,
				});
			} else if (isDirectory && recursively) {
				subdirectories.push(dirent.name);
			}
		}

		if (subdirectories.length === 0) {
			return;
		}

		if (depth + 1 > maxDepth) {
			if (!warnedAboutDepth) {
				warnedAboutDepth = true;
				warn?.(
					`Directory walk stopped at depth ${maxDepth} in ${dirFsPath}; anything below it is not indexed.`,
				);
			}
			return;
		}

		for (const name of subdirectories) {
			await descendInto(
				path.join(dirFsPath, name),
				prefix + name + "/",
				depth + 1,
			);
		}
	}

	async function descendInto(
		dirFsPath: string,
		prefix: string,
		depth: number,
	): Promise<void> {
		// The guard the vscode.workspace.fs walk has no equivalent of. A junction or symlink pointing
		// at one of its own ancestors turns a walk into an endless one, and following symlinks at all
		// is what makes that reachable. realpath is the mechanism available here: readdir's Dirent
		// carries no inode, and on Windows Stats.ino is not dependable across filesystems. It costs one
		// syscall per directory against one per file for the mtimes. Keeping the set for the whole walk
		// rather than per branch also collapses two junctions that point at the same real folder.
		const realPath = await realPathOrUndefined(dirFsPath);
		if (realPath === undefined) {
			return;
		}
		if (visitedDirectories.has(realPath)) {
			if (!warnedAboutCycle) {
				warnedAboutCycle = true;
				warn?.(
					`Directory walk skipped ${dirFsPath}: it resolves to ${realPath}, which it has already walked.`,
				);
			}
			return;
		}
		visitedDirectories.add(realPath);

		await readDirectoryInto(dirFsPath, prefix, depth);
	}
}

function normalizeRealPath(realPath: string): string {
	// realpath canonicalises the casing of the segments it resolves, but not the drive letter, which
	// varies with how the path was typed into the setting.
	return process.platform === "win32" ? realPath.toLowerCase() : realPath;
}

async function realPathOrUndefined(fsPath: string): Promise<string | undefined> {
	try {
		return normalizeRealPath(await fs.realpath(fsPath));
	} catch {
		// A broken junction or a folder we may not open. Undefined means "do not descend".
		return undefined;
	}
}

async function statOrUndefined(
	fsPath: string,
): Promise<import("node:fs").Stats | undefined> {
	try {
		return await fs.stat(fsPath);
	} catch {
		return undefined;
	}
}
