import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as zlib from "zlib";
import { openZipIndex } from "../util/nativezip";

// The reader runs on node's own fs against real archives, so it is tested against real files. Two
// fixture builders, because they cover different ground: adm-zip writes archives shaped the way the
// game's own DLC zips are, and buildZip writes the ones adm-zip cannot -- a stored non-empty entry,
// a data descriptor, a local extra field that differs from the central one, an encryption bit, an
// unknown method, zip64. Those are exactly the shapes where a zip reader goes quietly wrong.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;

interface FixtureEntry {
	name: string;
	data?: Buffer;
	/** 0 stored, 8 deflated. Defaults to 0, so `data` is written as-is unless asked otherwise. */
	method?: number;
	flags?: number;
	/** Written into the local header only, so a test can make the two extra fields disagree. */
	localExtra?: Buffer;
	centralExtra?: Buffer;
	/** Zero the local header's crc and sizes, as a writer that streamed the entry would. */
	sizesInDescriptor?: boolean;
	/** Write 0xFFFFFFFF for the local header offset and put the real one in a zip64 extra field. */
	zip64Offset?: boolean;
	/** Corrupt the stored bytes after they are compressed, leaving the sizes intact. */
	corruptData?: boolean;
	/** Write a local header signature that is not one. */
	corruptLocalHeader?: boolean;
}

interface BuildZipOptions {
	comment?: Buffer;
	/** Bytes written before the first local header, as a self-extracting stub would be. */
	prepend?: Buffer;
}

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive assembled by hand: local headers and data, then the central directory, then the end
 * of central directory record, plus a zip64 record and locator when any entry asked for one.
 */
function buildZip(
	entries: FixtureEntry[],
	options: BuildZipOptions = {},
): Buffer {
	// Offsets are recorded from the start of the zip, and the prepended stub is only concatenated on
	// at the end. That is what a self-extracting archive really looks like: every offset in it is
	// stale by the length of the stub, and a reader has to work that out from the record layout.
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	let anyZip64 = false;

	for (const entry of entries) {
		const raw = entry.data ?? Buffer.alloc(0);
		const method = entry.method ?? 0;
		let compressed = method === 8 ? zlib.deflateRawSync(raw) : raw;
		if (entry.corruptData) {
			compressed = Buffer.from(compressed);
			for (let i = 0; i < compressed.length; i++) {
				compressed[i] = compressed[i]! ^ 0xff;
			}
		}

		const name = Buffer.from(entry.name, "utf8");
		const localExtra = entry.localExtra ?? Buffer.alloc(0);
		const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
		const flags = entry.flags ?? (entry.sizesInDescriptor ? 0x0008 : 0);
		const crc = crc32(raw);

		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(
			entry.corruptLocalHeader ? 0xdeadbeef : LOCAL_HEADER_SIGNATURE,
			0,
		);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(flags, 6);
		localHeader.writeUInt16LE(method, 8);
		localHeader.writeUInt32LE(entry.sizesInDescriptor ? 0 : crc, 14);
		localHeader.writeUInt32LE(
			entry.sizesInDescriptor ? 0 : compressed.length,
			18,
		);
		localHeader.writeUInt32LE(entry.sizesInDescriptor ? 0 : raw.length, 22);
		localHeader.writeUInt16LE(name.length, 26);
		localHeader.writeUInt16LE(localExtra.length, 28);

		const localHeaderOffset = offset;
		parts.push(localHeader, name, localExtra, compressed);
		offset += 30 + name.length + localExtra.length + compressed.length;

		if (entry.sizesInDescriptor) {
			const descriptor = Buffer.alloc(16);
			descriptor.writeUInt32LE(0x08074b50, 0);
			descriptor.writeUInt32LE(crc, 4);
			descriptor.writeUInt32LE(compressed.length, 8);
			descriptor.writeUInt32LE(raw.length, 12);
			parts.push(descriptor);
			offset += descriptor.length;
		}

		let extra = centralExtra;
		if (entry.zip64Offset) {
			anyZip64 = true;
			// Only the offset overflowed, so the payload carries exactly one 8 byte field. A reader
			// that expects the offset at a fixed position in the payload reads past its end here.
			const zip64 = Buffer.alloc(12);
			zip64.writeUInt16LE(0x0001, 0);
			zip64.writeUInt16LE(8, 2);
			zip64.writeBigUInt64LE(BigInt(localHeaderOffset), 4);
			extra = Buffer.concat([extra, zip64]);
		}

		const header = Buffer.alloc(46);
		header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(20, 6);
		header.writeUInt16LE(flags, 8);
		header.writeUInt16LE(method, 10);
		header.writeUInt32LE(crc, 16);
		header.writeUInt32LE(compressed.length, 20);
		header.writeUInt32LE(raw.length, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt16LE(extra.length, 30);
		header.writeUInt32LE(
			entry.zip64Offset ? 0xffffffff : localHeaderOffset,
			42,
		);
		central.push(header, name, extra);
	}

	const centralDirectory = Buffer.concat(central);
	const centralDirectoryOffset = offset;
	parts.push(centralDirectory);
	offset += centralDirectory.length;

	if (anyZip64) {
		const record = Buffer.alloc(56);
		record.writeUInt32LE(ZIP64_EOCD_SIGNATURE, 0);
		record.writeBigUInt64LE(BigInt(44), 4);
		record.writeBigUInt64LE(BigInt(entries.length), 24);
		record.writeBigUInt64LE(BigInt(entries.length), 32);
		record.writeBigUInt64LE(BigInt(centralDirectory.length), 40);
		record.writeBigUInt64LE(BigInt(centralDirectoryOffset), 48);

		const locator = Buffer.alloc(20);
		locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
		locator.writeBigUInt64LE(BigInt(offset), 8);
		locator.writeUInt32LE(1, 16);

		parts.push(record, locator);
		offset += record.length + locator.length;
	}

	const comment = options.comment ?? Buffer.alloc(0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
	eocd.writeUInt16LE(entries.length & 0xffff, 8);
	eocd.writeUInt16LE(entries.length & 0xffff, 10);
	eocd.writeUInt32LE(centralDirectory.length, 12);
	eocd.writeUInt32LE(centralDirectoryOffset, 16);
	eocd.writeUInt16LE(comment.length, 20);
	parts.push(eocd, comment);

	return Buffer.concat([options.prepend ?? Buffer.alloc(0), ...parts]);
}

describe("util/nativezip openZipIndex", function () {
	let root: string;

	beforeEach(async function () {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "hoi4zip-"));
	});

	afterEach(async function () {
		await fs.rm(root, { recursive: true, force: true });
	});

	async function write(name: string, content: Buffer): Promise<string> {
		const full = path.join(root, name);
		await fs.writeFile(full, content);
		return full;
	}

	async function writeAdmZip(
		files: [string, Buffer][],
	): Promise<string> {
		const AdmZip = require("adm-zip");
		const zip = new AdmZip();
		for (const [name, data] of files) {
			zip.addFile(name, data);
		}
		const full = path.join(root, "adm.zip");
		zip.writeZip(full);
		return full;
	}

	it("indexes every central directory entry with its name and directory flag", async function () {
		const index = await openZipIndex(
			await writeAdmZip([
				["gfx/interface/foo.dds", Buffer.from("foo")],
				["gfx/interface/", Buffer.alloc(0)],
				["gfx/other.dds", Buffer.from("other")],
				["empty.txt", Buffer.alloc(0)],
			]),
		);

		assert.deepStrictEqual(
			index.entries.map((e) => e.name).sort(),
			["empty.txt", "gfx/interface/", "gfx/interface/foo.dds", "gfx/other.dds"],
		);
		assert.deepStrictEqual(
			index.entries.filter((e) => e.isDirectory).map((e) => e.name),
			["gfx/interface/"],
		);
	});

	it("inflates a deflated entry back to its exact bytes", async function () {
		const payload = Buffer.from("focus = { id = test }\n".repeat(400));
		const index = await openZipIndex(
			await writeAdmZip([["common/focus.txt", payload]]),
		);
		assert.deepStrictEqual(await index.readEntry("common/focus.txt"), payload);
	});

	it("round-trips binary bytes rather than text", async function () {
		const payload = Buffer.alloc(4096);
		for (let i = 0; i < payload.length; i++) {
			payload[i] = i % 256;
		}
		const index = await openZipIndex(
			await writeAdmZip([["gfx/a.dds", payload]]),
		);
		assert.deepStrictEqual(await index.readEntry("gfx/a.dds"), payload);
	});

	it("reads a stored entry that was never compressed", async function () {
		const payload = Buffer.from("stored, not deflated");
		const index = await openZipIndex(
			await write(
				"stored.zip",
				buildZip([{ name: "a.txt", data: payload, method: 0 }]),
			),
		);
		assert.deepStrictEqual(await index.readEntry("a.txt"), payload);
	});

	it("returns an empty buffer for a zero-length entry", async function () {
		const index = await openZipIndex(
			await writeAdmZip([["empty.txt", Buffer.alloc(0)]]),
		);
		assert.deepStrictEqual(await index.readEntry("empty.txt"), Buffer.alloc(0));
	});

	it("returns null for a name the archive does not hold", async function () {
		const index = await openZipIndex(
			await writeAdmZip([["a.txt", Buffer.from("a")]]),
		);
		assert.strictEqual(await index.readEntry("b.txt"), null);
	});

	it("skips the local header's own extra field, which differs from the central one", async function () {
		const payload = Buffer.from("the bytes after a longer local extra field");
		const index = await openZipIndex(
			await write(
				"extra.zip",
				buildZip([
					{
						name: "a.txt",
						data: payload,
						method: 8,
						localExtra: Buffer.alloc(17, 0x5a),
					},
				]),
			),
		);
		assert.deepStrictEqual(await index.readEntry("a.txt"), payload);
	});

	it("trusts the central directory's sizes when the local header defers them to a data descriptor", async function () {
		const payload = Buffer.from("streamed out before its size was known".repeat(20));
		const index = await openZipIndex(
			await write(
				"streamed.zip",
				buildZip([
					{ name: "a.txt", data: payload, method: 8, sizesInDescriptor: true },
					{ name: "b.txt", data: Buffer.from("second"), method: 8 },
				]),
			),
		);
		assert.deepStrictEqual(await index.readEntry("a.txt"), payload);
		assert.deepStrictEqual(
			await index.readEntry("b.txt"),
			Buffer.from("second"),
		);
	});

	it("finds the end of central directory past an archive comment", async function () {
		const index = await openZipIndex(
			await write(
				"comment.zip",
				buildZip([{ name: "a.txt", data: Buffer.from("a") }], {
					comment: Buffer.alloc(300, 0x20),
				}),
			),
		);
		assert.deepStrictEqual(await index.readEntry("a.txt"), Buffer.from("a"));
	});

	it("ignores an end of central directory signature inside the comment", async function () {
		const comment = Buffer.concat([
			Buffer.alloc(40, 0x20),
			Buffer.from([0x50, 0x4b, 0x05, 0x06]),
			Buffer.alloc(40, 0x20),
		]);
		const index = await openZipIndex(
			await write(
				"fakesig.zip",
				buildZip([{ name: "a.txt", data: Buffer.from("a") }], { comment }),
			),
		);
		assert.deepStrictEqual(await index.readEntry("a.txt"), Buffer.from("a"));
	});

	it("ignores an end of central directory signature inside an entry's data", async function () {
		const payload = Buffer.concat([
			Buffer.from("before"),
			Buffer.from([0x50, 0x4b, 0x05, 0x06]),
			Buffer.alloc(30, 0),
		]);
		const index = await openZipIndex(
			await write(
				"datasig.zip",
				buildZip([{ name: "a.txt", data: payload, method: 0 }]),
			),
		);
		assert.deepStrictEqual(await index.readEntry("a.txt"), payload);
	});

	it("opens an archive with no entries at all", async function () {
		const index = await openZipIndex(await write("empty.zip", buildZip([])));
		assert.deepStrictEqual(index.entries, []);
		assert.strictEqual(await index.readEntry("a.txt"), null);
	});

	it("finds the entries of an archive with a self-extracting stub prepended", async function () {
		const index = await openZipIndex(
			await write(
				"sfx.zip",
				buildZip([{ name: "a.txt", data: Buffer.from("stubbed") }], {
					prepend: Buffer.alloc(512, 0x4d),
				}),
			),
		);
		assert.deepStrictEqual(
			await index.readEntry("a.txt"),
			Buffer.from("stubbed"),
		);
	});

	it("indexes an encrypted entry but refuses to read it", async function () {
		const index = await openZipIndex(
			await write(
				"encrypted.zip",
				buildZip([
					{ name: "a.txt", data: Buffer.from("secret"), flags: 0x0001 },
					{ name: "b.txt", data: Buffer.from("plain") },
				]),
			),
		);
		assert.deepStrictEqual(
			index.entries.map((e) => e.name),
			["a.txt", "b.txt"],
		);
		await assert.rejects(() => index.readEntry("a.txt"), /encrypted/i);
		assert.deepStrictEqual(
			await index.readEntry("b.txt"),
			Buffer.from("plain"),
		);
	});

	it("indexes an entry with an unsupported compression method but refuses to read it", async function () {
		const index = await openZipIndex(
			await write(
				"bzip.zip",
				buildZip([{ name: "a.txt", data: Buffer.from("payload"), method: 12 }]),
			),
		);
		assert.deepStrictEqual(
			index.entries.map((e) => e.name),
			["a.txt"],
		);
		await assert.rejects(
			() => index.readEntry("a.txt"),
			/unsupported compression method 12/i,
		);
	});

	it("rejects a corrupt deflate stream instead of returning a short buffer", async function () {
		const index = await openZipIndex(
			await write(
				"corrupt.zip",
				buildZip([
					{
						name: "a.txt",
						data: Buffer.from("x".repeat(2000)),
						method: 8,
						corruptData: true,
					},
				]),
			),
		);
		await assert.rejects(() => index.readEntry("a.txt"));
	});

	it("rejects an entry whose central directory claims bytes the archive does not hold", async function () {
		const raw = buildZip([{ name: "a.txt", data: Buffer.from("hello") }]);
		// Claim a longer uncompressed size than the stored bytes, the way a zero-padding reader
		// would silently paper over. The compressed size still matches, so only the check on the
		// unpacked length catches it.
		const centralSizeOffset = raw.indexOf(Buffer.from("hello")) + 5 + 24;
		raw.writeUInt32LE(9999, centralSizeOffset);
		const index = await openZipIndex(await write("short.zip", raw));
		await assert.rejects(() => index.readEntry("a.txt"), /unpacked to 5 bytes/);
	});

	it("throws when a local header is not where the central directory says", async function () {
		const index = await openZipIndex(
			await write(
				"nolocal.zip",
				buildZip([
					{
						name: "a.txt",
						data: Buffer.from("payload"),
						corruptLocalHeader: true,
					},
				]),
			),
		);
		await assert.rejects(
			() => index.readEntry("a.txt"),
			/a\.txt.*no local header/,
		);
	});

	it("reads an entry whose local header offset lives in the zip64 extra field", async function () {
		const payload = Buffer.from("found through the zip64 extra field");
		const index = await openZipIndex(
			await write(
				"zip64.zip",
				buildZip([
					{ name: "a.txt", data: Buffer.from("first") },
					{ name: "b.txt", data: payload, method: 8, zip64Offset: true },
				]),
			),
		);
		assert.deepStrictEqual(await index.readEntry("b.txt"), payload);
		assert.deepStrictEqual(
			await index.readEntry("a.txt"),
			Buffer.from("first"),
		);
	});

	it("throws when a zip64 extra field is too short for the sentinels it promises", async function () {
		const raw = buildZip([
			{ name: "a.txt", data: Buffer.from("x"), zip64Offset: true },
		]);
		// Flag the compressed size as overflowed too. The extra field carries one 8 byte field, which
		// now has to cover two, and a reader that indexes into it at fixed positions reads garbage
		// rather than noticing.
		const centralHeader = raw.lastIndexOf("a.txt") - 46;
		raw.writeUInt32LE(0xffffffff, centralHeader + 20);
		const file = await write("badzip64.zip", raw);
		await assert.rejects(
			() => openZipIndex(file),
			/zip64 extended information/,
		);
	});

	it("decodes entry names as UTF-8 whether or not the entry flags it", async function () {
		const name = "gfx/café.dds";
		const flagged = await openZipIndex(
			await write(
				"flagged.zip",
				buildZip([{ name, data: Buffer.from("a"), flags: 0x0800 }]),
			),
		);
		const unflagged = await openZipIndex(
			await write("unflagged.zip", buildZip([{ name, data: Buffer.from("a") }])),
		);
		assert.deepStrictEqual(
			flagged.entries.map((e) => e.name),
			[name],
		);
		assert.deepStrictEqual(
			unflagged.entries.map((e) => e.name),
			[name],
		);
		assert.deepStrictEqual(await unflagged.readEntry(name), Buffer.from("a"));
	});

	it("lists both copies of a duplicated name and resolves the last one", async function () {
		const index = await openZipIndex(
			await write(
				"dupe.zip",
				buildZip([
					{ name: "a.txt", data: Buffer.from("first") },
					{ name: "a.txt", data: Buffer.from("second") },
				]),
			),
		);
		assert.deepStrictEqual(
			index.entries.map((e) => e.name),
			["a.txt", "a.txt"],
		);
		assert.deepStrictEqual(
			await index.readEntry("a.txt"),
			Buffer.from("second"),
		);
	});

	it("reads many entries concurrently", async function () {
		const files: [string, Buffer][] = [];
		for (let i = 0; i < 20; i++) {
			files.push([`f${i}.txt`, Buffer.from(`payload ${i} `.repeat(50))]);
		}
		const index = await openZipIndex(await writeAdmZip(files));

		const read = await Promise.all(
			[...files, ...files].map(([name]) => index.readEntry(name)),
		);
		read.forEach((buffer, i) => {
			assert.deepStrictEqual(buffer, files[i % files.length]![1]);
		});
	});

	it("throws for a file that is not a zip archive", async function () {
		const file = await write("notazip.bin", Buffer.alloc(1000, 0x41));
		await assert.rejects(
			() => openZipIndex(file),
			/no end of central directory record/,
		);
	});

	it("throws for a file too small to hold an end of central directory record", async function () {
		const file = await write("tiny.bin", Buffer.from("PK"));
		await assert.rejects(() => openZipIndex(file), /too small to be a zip/);
	});

	it("throws for a path that does not exist", async function () {
		await assert.rejects(() => openZipIndex(path.join(root, "missing.zip")));
	});

	it("throws when the central directory is past the end of the file", async function () {
		const raw = buildZip([{ name: "a.txt", data: Buffer.from("a") }]);
		raw.writeUInt32LE(0x0fffffff, raw.length - 6);
		const file = await write("badoffset.zip", raw);
		await assert.rejects(() => openZipIndex(file), /past the end/);
	});
});
