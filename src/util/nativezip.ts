/*
 * A random-access reader for zip archives, for the HOI4 DLC zips.
 *
 * The alternative, and what this replaces, is adm-zip: `new AdmZip(path)` is a `readFileSync` of the
 * whole archive, and it has no way to read one entry without it. A DLC zip is tens to hundreds of
 * megabytes and an index build reads thousands of entries out of one, so the cost of reading a
 * hundred-byte localisation file was a hundred-megabyte synchronous read on the extension host's
 * only thread. Here an entry read is the central directory (already in memory), one positioned read
 * of the compressed bytes, and an inflate on libuv's threadpool.
 *
 * This module is node-only. It is loaded through `require` from inside an `if (!IS_WEB_EXT)` block so
 * webpack's DefinePlugin drops the branch and never tries to resolve `node:fs/promises` for the web
 * bundle, which has no `fs` at all.
 */

const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const zlib = require("node:zlib") as typeof import("node:zlib");

/** End of central directory record: signature, then 18 bytes of fields and a comment length. */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
/** The comment is a uint16 length, so the record can start no further back than this from the end. */
const MAX_EOCD_SEARCH = EOCD_SIZE + 0xffff;

const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_SIZE = 56;

const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;

/** Header id of the zip64 extended information extra field. */
const ZIP64_EXTRA_ID = 0x0001;

/** Set when the entry is encrypted. Bit 6, strong encryption, is only ever set alongside it. */
const FLAG_ENCRYPTED = 0x0001;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/** The uint16 and uint32 values a zip64 field replaces. */
const U16_SENTINEL = 0xffff;
const U32_SENTINEL = 0xffffffff;

export interface ZipEntryInfo {
	/** The name exactly as the central directory spells it, decoded as UTF-8. */
	name: string;
	/** Name-based, like adm-zip's: a trailing `/` or `\`. Nothing reads the MS-DOS attribute bit. */
	isDirectory: boolean;
}

export interface ZipIndex {
	/** One per central directory record, in the order the directory lists them, duplicates included. */
	readonly entries: readonly ZipEntryInfo[];
	/** The entry's bytes, or null when the archive holds no entry of that name. */
	readEntry(name: string): Promise<Buffer | null>;
}

interface ZipEntryRecord {
	/** Kept raw so the encryption check happens per read: one bad entry costs that entry, not the zip. */
	flags: number;
	compressionMethod: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
	/** The directory's checksum of the unpacked bytes. Zero when the writer left the field out. */
	crc32: number;
}

interface CentralDirectoryLocation {
	offset: number;
	size: number;
	/** Non-zero only for an archive with something prepended to it; added to every local header offset. */
	delta: number;
}

/**
 * Reads `fsPath`'s central directory and hands back an index over it. The archive is closed again
 * before this resolves: `readEntry` opens its own handle per read, which is what keeps a read safe
 * when the caching layer above drops the index while a read is still in flight.
 *
 * Throws if the file is not a readable zip. Whoever asked gets a real Error, unlike adm-zip, which
 * throws a bare string for a missing file.
 */
export async function openZipIndex(fsPath: string): Promise<ZipIndex> {
	const records = new Map<string, ZipEntryRecord>();
	const entries: ZipEntryInfo[] = [];

	const handle = await fs.open(fsPath, "r");
	try {
		const { size } = await handle.stat();
		if (size < EOCD_SIZE) {
			throw new Error(
				`${fsPath} is ${size} bytes, too small to be a zip archive.`,
			);
		}

		const location = await readCentralDirectoryLocation(handle, size, fsPath);
		if (location.offset + location.size > size) {
			throw new Error(
				`${fsPath} says its central directory is ${location.size} bytes at ${location.offset}, past the end of a ${size} byte file.`,
			);
		}

		const centralDirectory = await readExact(
			handle,
			location.offset,
			location.size,
			fsPath,
		);
		readCentralDirectory(centralDirectory, location.delta, fsPath, (info, record) => {
			entries.push(info);
			// Last wins, as adm-zip's entry table does. A name may legally appear twice, and both
			// copies stay in `entries` because the listing above dedupes only when it means to.
			records.set(info.name, record);
		});
	} finally {
		await handle.close();
	}

	return {
		entries,
		readEntry: (name) => readEntry(fsPath, records.get(name), name),
	};
}

async function readEntry(
	fsPath: string,
	record: ZipEntryRecord | undefined,
	name: string,
): Promise<Buffer | null> {
	if (record === undefined) {
		return null;
	}

	if ((record.flags & FLAG_ENCRYPTED) !== 0) {
		throw new Error(`Entry ${name} in ${fsPath} is encrypted.`);
	}

	if (record.compressedSize === 0) {
		if (record.uncompressedSize !== 0) {
			// A streamed archive whose central directory was never fixed up. Handing back an empty
			// buffer is exactly the silent corruption this reader exists to stop doing.
			throw new Error(
				`Entry ${name} in ${fsPath} holds no compressed data but claims ${record.uncompressedSize} bytes.`,
			);
		}
		return Buffer.alloc(0);
	}

	const handle = await fs.open(fsPath, "r");
	let compressed: Buffer;
	try {
		const { size } = await handle.stat();
		// Both reads below are bounds-checked before they happen, because a length taken from the
		// directory reaches Buffer.alloc before the read that would have failed on it: a corrupt size
		// field is then a multi-gigabyte zero-fill on the extension host's only thread rather than an
		// error.
		requireWithinFile(
			record.localHeaderOffset,
			LOCAL_HEADER_SIZE,
			size,
			name,
			fsPath,
		);
		const localHeader = await readExact(
			handle,
			record.localHeaderOffset,
			LOCAL_HEADER_SIZE,
			fsPath,
		);
		if (localHeader.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
			throw new Error(
				`Entry ${name} in ${fsPath} has no local header at ${record.localHeaderOffset}.`,
			);
		}

		// The local extra field is regularly longer than the central one -- timestamps, zip64
		// placeholders, alignment padding -- so its length has to come from the local header. Taking
		// it from the central record lands a few bytes into the compressed data, which inflates to
		// garbage rather than failing.
		const dataOffset =
			record.localHeaderOffset +
			LOCAL_HEADER_SIZE +
			localHeader.readUInt16LE(26) +
			localHeader.readUInt16LE(28);
		requireWithinFile(dataOffset, record.compressedSize, size, name, fsPath);
		compressed = await readExact(
			handle,
			dataOffset,
			record.compressedSize,
			fsPath,
		);
	} finally {
		await handle.close();
	}

	let data: Buffer;
	if (record.compressionMethod === METHOD_STORED) {
		data = compressed;
	} else if (record.compressionMethod === METHOD_DEFLATED) {
		data = await inflateRaw(compressed);
	} else {
		throw new Error(
			`Entry ${name} in ${fsPath} uses unsupported compression method ${record.compressionMethod}.`,
		);
	}

	if (data.length !== record.uncompressedSize) {
		throw new Error(
			`Entry ${name} in ${fsPath} unpacked to ${data.length} bytes, not the ${record.uncompressedSize} its directory entry claims.`,
		);
	}
	// The length alone does not catch corruption that kept it: a stored entry whose bytes were
	// flipped in place unpacks to exactly the promised size. A zero checksum is a writer that left
	// the field out rather than data that really hashes to zero, so it is not compared.
	if (record.uncompressedSize > 0 && record.crc32 !== 0) {
		const actual = crc32(data);
		if (actual !== record.crc32) {
			throw new Error(
				`Entry ${name} in ${fsPath} has checksum ${hex32(actual)}, not the ${hex32(record.crc32)} its directory entry claims.`,
			);
		}
	}
	return data;
}

function hex32(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}

/**
 * CRC-32 of `data`, through node's own implementation where the running version has one and a table
 * of our own where it does not -- `zlib.crc32` only arrived in node 20.15, and the extension host
 * runs whatever node the user's VS Code was built against.
 */
const nativeCrc32 = (zlib as { crc32?: (data: Buffer) => number }).crc32;

function crc32(data: Buffer): number {
	return nativeCrc32 !== undefined ? nativeCrc32(data) : crc32Table(data);
}

let crcTable: Uint32Array | undefined;

/**
 * Exported only so it can be tested: on a node that has `zlib.crc32` this never runs, and a version
 * of it that is quietly wrong would first be noticed by a user on an older VS Code.
 */
export function crc32Table(data: Buffer): number {
	if (crcTable === undefined) {
		crcTable = new Uint32Array(256);
		for (let i = 0; i < 256; i++) {
			let value = i;
			for (let bit = 0; bit < 8; bit++) {
				value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
			}
			crcTable[i] = value >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Guards a positioned read whose length came out of the archive, before it becomes an allocation. */
function requireWithinFile(
	position: number,
	length: number,
	size: number,
	name: string,
	fsPath: string,
): void {
	if (position < 0 || position + length > size) {
		throw new Error(
			`Entry ${name} in ${fsPath} points at ${length} bytes at ${position}, past the end of a ${size} byte file.`,
		);
	}
}

function inflateRaw(compressed: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zlib.inflateRaw(compressed, (error: Error | null, result: Buffer) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
}

/**
 * Where the central directory is, from the end of central directory record and, when the archive
 * carries one, the zip64 record behind it.
 */
async function readCentralDirectoryLocation(
	handle: import("node:fs/promises").FileHandle,
	size: number,
	fsPath: string,
): Promise<CentralDirectoryLocation> {
	const tailLength = Math.min(size, MAX_EOCD_SEARCH);
	const tailStart = size - tailLength;
	const tail = await readExact(handle, tailStart, tailLength, fsPath);

	const eocdInTail = findEndOfCentralDirectory(tail);
	if (eocdInTail === undefined) {
		throw new Error(
			`${fsPath} has no end of central directory record; it is not a zip archive.`,
		);
	}
	const eocdOffset = tailStart + eocdInTail;

	const zip64 = await readZip64Location(handle, tail, eocdInTail, fsPath);
	if (zip64 !== undefined) {
		// No prepend correction here: in a zip64 archive the central directory is followed by the
		// zip64 record and its locator, so "where the directory must have ended" is not the offset
		// the plain arithmetic below computes, and correcting the locator's own offset with a value
		// derived from it would be circular.
		return { ...zip64, delta: 0 };
	}

	const offset = tail.readUInt32LE(eocdInTail + 16);
	const cdSize = tail.readUInt32LE(eocdInTail + 12);
	// A self-extracting archive has its stub prepended, which shifts every offset the directory
	// records by the stub's length. The directory ends where the record describing it begins, so the
	// shift is the difference between that and the offset the archive claims.
	const delta = Math.max(0, eocdOffset - cdSize - offset);
	// That arithmetic also comes out non-zero for an archive that is not shifted at all: a zip may
	// legally carry an archive extra data or digital signature record between the directory and the
	// end record, and the gap looks exactly like a stub. So the correction is a fallback, used only
	// when the offset the archive declares does not hold a directory record.
	if (
		delta === 0 ||
		cdSize === 0 ||
		(await hasCentralSignature(handle, offset, size, fsPath))
	) {
		return { offset, size: cdSize, delta: 0 };
	}
	return { offset: offset + delta, size: cdSize, delta };
}

/** Whether a central directory record starts at `offset`; false rather than throwing if it cannot look. */
async function hasCentralSignature(
	handle: import("node:fs/promises").FileHandle,
	offset: number,
	size: number,
	fsPath: string,
): Promise<boolean> {
	if (offset < 0 || offset + 4 > size) {
		return false;
	}
	try {
		const probe = await readExact(handle, offset, 4, fsPath);
		return probe.readUInt32LE(0) === CENTRAL_HEADER_SIGNATURE;
	} catch {
		return false;
	}
}

/**
 * The last position in `tail` carrying an end of central directory record. The signature alone is not
 * enough -- those four bytes turn up inside compressed data and inside comments -- so a candidate
 * counts only when its comment length accounts for exactly the bytes that follow it.
 */
function findEndOfCentralDirectory(tail: Buffer): number | undefined {
	for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
		if (
			tail.readUInt32LE(i) === EOCD_SIGNATURE &&
			tail.readUInt16LE(i + 20) === tail.length - (i + EOCD_SIZE)
		) {
			return i;
		}
	}
	return undefined;
}

/**
 * The zip64 end of central directory record's view of where the directory is, or undefined when the
 * archive has no zip64 locator.
 *
 * Gated on the locator being present rather than on the 0xFFFF/0xFFFFFFFF sentinels in the plain
 * record: writers emit zip64 whenever one field overflows, and some emit it unconditionally, so the
 * sentinels are not a reliable signal that the plain fields can be trusted.
 */
async function readZip64Location(
	handle: import("node:fs/promises").FileHandle,
	tail: Buffer,
	eocdInTail: number,
	fsPath: string,
): Promise<{ offset: number; size: number } | undefined> {
	const locatorInTail = eocdInTail - ZIP64_LOCATOR_SIZE;
	if (
		locatorInTail < 0 ||
		tail.readUInt32LE(locatorInTail) !== ZIP64_LOCATOR_SIGNATURE
	) {
		return undefined;
	}

	const recordOffset = toSafeNumber(
		tail.readBigUInt64LE(locatorInTail + 8),
		"zip64 end of central directory offset",
		fsPath,
	);
	// Its own read: the record sits before the locator, which for an archive with a long comment can
	// put it outside the tail already in hand.
	const record = await readExact(
		handle,
		recordOffset,
		ZIP64_EOCD_SIZE,
		fsPath,
	);
	if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
		throw new Error(
			`${fsPath} has no zip64 end of central directory record at ${recordOffset}.`,
		);
	}

	return {
		size: toSafeNumber(
			record.readBigUInt64LE(40),
			"zip64 central directory size",
			fsPath,
		),
		offset: toSafeNumber(
			record.readBigUInt64LE(48),
			"zip64 central directory offset",
			fsPath,
		),
	};
}

/**
 * Walks the central directory record by record. Driven by the signature rather than by the record
 * count the archive declares, which some writers get wrong, and which is capped at 0xFFFF anyway
 * unless the zip64 record says otherwise.
 */
function readCentralDirectory(
	centralDirectory: Buffer,
	delta: number,
	fsPath: string,
	onEntry: (info: ZipEntryInfo, record: ZipEntryRecord) => void,
): void {
	let cursor = 0;
	while (
		cursor + CENTRAL_HEADER_SIZE <= centralDirectory.length &&
		centralDirectory.readUInt32LE(cursor) === CENTRAL_HEADER_SIGNATURE
	) {
		const nameLength = centralDirectory.readUInt16LE(cursor + 28);
		const extraLength = centralDirectory.readUInt16LE(cursor + 30);
		const commentLength = centralDirectory.readUInt16LE(cursor + 32);
		const recordEnd =
			cursor + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
		if (recordEnd > centralDirectory.length) {
			throw new Error(
				`${fsPath} has a central directory record at ${cursor} that runs past the directory's ${centralDirectory.length} bytes.`,
			);
		}

		const nameStart = cursor + CENTRAL_HEADER_SIZE;
		// Decoded as UTF-8 whether or not the entry sets the UTF-8 flag, because adm-zip's entryName
		// was a plain toString() and this name has to keep matching it: it becomes a URI fragment that
		// getFilePathFromModOrHOI4 hands out and readFileFromPath looks up again. Decoding a
		// flagless name as CP437 instead would be more correct and would make it resolve, then fail
		// to read.
		const name = centralDirectory.toString(
			"utf8",
			nameStart,
			nameStart + nameLength,
		);
		const extra = centralDirectory.subarray(
			nameStart + nameLength,
			nameStart + nameLength + extraLength,
		);

		const sizes = resolveZip64Sizes(
			{
				uncompressedSize: centralDirectory.readUInt32LE(cursor + 24),
				compressedSize: centralDirectory.readUInt32LE(cursor + 20),
				localHeaderOffset: centralDirectory.readUInt32LE(cursor + 42),
				diskStart: centralDirectory.readUInt16LE(cursor + 34),
			},
			extra,
			name,
			fsPath,
		);

		onEntry(
			{ name, isDirectory: isDirectoryName(name) },
			{
				flags: centralDirectory.readUInt16LE(cursor + 8),
				compressionMethod: centralDirectory.readUInt16LE(cursor + 10),
				crc32: centralDirectory.readUInt32LE(cursor + 16),
				compressedSize: sizes.compressedSize,
				uncompressedSize: sizes.uncompressedSize,
				localHeaderOffset: sizes.localHeaderOffset + delta,
			},
		);

		cursor = recordEnd;
	}

	// A correct walk ends on the last byte of the directory, and an archive with no entries has no
	// directory to walk. Anything else means the bytes read are not the directory the end record
	// pointed at, and stopping quietly here is how a wrong offset turns into an empty index that
	// every DLC lookup then misses for as long as the index is cached.
	if (cursor !== centralDirectory.length) {
		throw new Error(
			`${fsPath} has no central directory record at ${cursor} of the ${centralDirectory.length} bytes its end record points at.`,
		);
	}
}

interface CentralSizes {
	uncompressedSize: number;
	compressedSize: number;
	localHeaderOffset: number;
	diskStart: number;
}

/**
 * The entry's real sizes and offset, reading the zip64 extended information extra field for whichever
 * of them the 32-bit record could not hold.
 *
 * The field's payload carries only the overflowed values, in a fixed order and with no tags, so it
 * has to be consumed one field at a time against the sentinels. Reading the offset at a fixed
 * position in the payload -- the usual shortcut -- walks off the end of an archive where only the
 * offset overflowed.
 */
function resolveZip64Sizes(
	central: CentralSizes,
	extra: Buffer,
	name: string,
	fsPath: string,
): CentralSizes {
	const needed =
		(central.uncompressedSize === U32_SENTINEL ? 8 : 0) +
		(central.compressedSize === U32_SENTINEL ? 8 : 0) +
		(central.localHeaderOffset === U32_SENTINEL ? 8 : 0) +
		(central.diskStart === U16_SENTINEL ? 4 : 0);
	if (needed === 0) {
		return central;
	}

	const payload = findZip64Extra(extra);
	if (payload === undefined || payload.length < needed) {
		throw new Error(
			`Entry ${name} in ${fsPath} needs ${needed} bytes of zip64 extended information, which its extra field does not carry.`,
		);
	}

	const resolved = { ...central };
	let cursor = 0;
	if (resolved.uncompressedSize === U32_SENTINEL) {
		resolved.uncompressedSize = toSafeNumber(
			payload.readBigUInt64LE(cursor),
			`uncompressed size of ${name}`,
			fsPath,
		);
		cursor += 8;
	}
	if (resolved.compressedSize === U32_SENTINEL) {
		resolved.compressedSize = toSafeNumber(
			payload.readBigUInt64LE(cursor),
			`compressed size of ${name}`,
			fsPath,
		);
		cursor += 8;
	}
	if (resolved.localHeaderOffset === U32_SENTINEL) {
		resolved.localHeaderOffset = toSafeNumber(
			payload.readBigUInt64LE(cursor),
			`local header offset of ${name}`,
			fsPath,
		);
	}
	return resolved;
}

/** The payload of the zip64 extra field, walking the extra field's `[id][size][data]` records. */
function findZip64Extra(extra: Buffer): Buffer | undefined {
	let cursor = 0;
	while (cursor + 4 <= extra.length) {
		const id = extra.readUInt16LE(cursor);
		const size = extra.readUInt16LE(cursor + 2);
		if (cursor + 4 + size > extra.length) {
			return undefined;
		}
		if (id === ZIP64_EXTRA_ID) {
			return extra.subarray(cursor + 4, cursor + 4 + size);
		}
		cursor += 4 + size;
	}
	return undefined;
}

/** Both separators, matching adm-zip: a zip written on Windows can end a directory name with `\`. */
function isDirectoryName(name: string): boolean {
	return name.endsWith("/") || name.endsWith("\\");
}

function toSafeNumber(value: bigint, what: string, fsPath: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(`${fsPath} has a ${what} of ${value}, which is too large.`);
	}
	return Number(value);
}

/**
 * Exactly `length` bytes at `position`. Every read here is positioned and none of them touch the
 * handle's own file position, which is what lets several reads share one archive concurrently.
 *
 * The loop is not decoration: a read is allowed to come back short, and a 30 byte local header that
 * arrives 12 bytes at a time would otherwise yield a plausible, wrong data offset.
 */
async function readExact(
	handle: import("node:fs/promises").FileHandle,
	position: number,
	length: number,
	fsPath: string,
): Promise<Buffer> {
	const buffer = Buffer.alloc(length);
	let read = 0;
	while (read < length) {
		const { bytesRead } = await handle.read(
			buffer,
			read,
			length - read,
			position + read,
		);
		if (bytesRead === 0) {
			throw new Error(
				`${fsPath} ended after ${read} of the ${length} bytes expected at ${position}.`,
			);
		}
		read += bytesRead;
	}
	return buffer;
}
