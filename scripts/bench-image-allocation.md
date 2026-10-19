# DDS/TGA conversion allocation experiment

Issue #556: the converter formerly allocated a blank PNG canvas, decoded pixels
into a separate array, and copied that array into a third full-sized raster. The
candidate constructs an empty PNG object, assigns its dimensions, and wraps the
decoder-owned RGBA storage using its exact byte offset and length.

## Ownership

- Both raw and block-compressed `Surface.getFullRgba` paths allocate a fresh
  `Uint8Array(width * height * 4)` on every call. Their output does not alias the DDS
  source, shared block colour scratch arrays, or another conversion.
- Locked dependency `tga@1.0.7` allocates fresh per-instance `pixels` in `parsePixels`.
  Shared `tempColor` values are copied into that array. Parsing and alpha correction
  finish during construction; the converter never reuses or exposes the decoder.
- Locked dependency `pngjs@7.0.0` leaves `data` null in `new PNG()`; its synchronous
  writer and asynchronous packer consume the instance's current dimensions/data.
  The Buffer view keeps its ArrayBuffer alive after the decoder becomes unreachable.

Image limits and malformed-input checks are unchanged. No input buffer is adopted
as output storage, and no new public API, ownership restriction or worker policy is
introduced.

## Reproduction

Compile both checkouts with the same dependencies before measuring:

```sh
npm run compile-test
# Run the same command in the baseline checkout.
node scripts/bench-image-allocation.js BASELINE CANDIDATE OUTPUT.json
```

Run only when other builds, tests and benchmarks are idle. The driver runs seven
AB/BA alternating pairs per kind and size, each in a fresh `--expose-gc` child:
512×512, 2048×2048 and 4096×2048 uncompressed DDS and TGA. Each input has deterministic
noise pixels. The largest decoded raster is 32 MiB, below the existing image limits;
there is one conversion per child and a 60-second parent watchdog. A child failure,
timeout, input mutation, RGBA mutation during encoding, or baseline/candidate PNG
byte mismatch fails the run. JSON is saved after every successful trial.

Untimed warmup uses only a 4×4 image. Inputs are generated and hashed before an
explicit GC and the first memory snapshot. Module load, fixture generation, GC,
pixel/output hashing and validation are outside the conversion/encode timers.

Synchronous `process.memoryUsage()` samples record RSS, heap, external memory and
ArrayBuffers before/after conversion and encoding, after decoded pixels are
allocated, after PNG construction, at full-raster Buffer allocations/copies/views,
after PNG filtering, and after deflate. These seams capture transient raster
storage during synchronous work that an event-loop sampling interval would miss.
The allocation counters distinguish blank canvases, typed-array copies and Buffer
views. They do not count the decoder's required RGBA allocation as a copy.

Phase peaks are maxima of the observed snapshots, **not exhaustive allocation
traces**. Short-lived allocations inside a phase can be missed. External memory and
ArrayBuffers are more direct observations for these raster buffers than JS heap;
RSS also depends on resident pages, garbage collection and the allocator. Lifetime
maximum RSS includes warmup/fixture creation and is separate from phase peaks.
The hooks and snapshots add overhead to the reported times on both variants.
Results describe this isolated converter/encoder, not editor or preview latency.

Report each scenario's seven trial-level medians and observed maxima for converter,
encoder, total time and phase memory. Observed maxima are descriptive tails, not
population p95/p99 estimates. Keep source, RGBA and PNG hashes with the raw evidence.
No whole-application speed or RSS improvement is inferred from these measurements.

## Checks before the measurement gate

A small allocation-spy reproduction on the compiled baseline and candidate found,
for **each** of DDS and TGA:

| Full-raster allocation boundary | Baseline | Candidate |
|---|---:|---:|
| Unused PNG canvas | 1 | 0 |
| Copy of decoded Uint8Array | 1 | 0 |

This is a deterministic allocation count, not a timing or memory measurement.
Five new unit cases cover the removed canvas/copy, nonzero decoded-view offsets,
exact PNG byte parity, and independence from source mutation/later raw DDS,
compressed DDS and TGA conversions. Existing invalid-input and image-limit tests
remain intact. Converter/DDS tests: 121 passing. Existing decoder, graphics loader
and DDS provider tests: 41 passing. Focused lint, test-project compilation and
`git diff --check` pass.

## Serialized results

[Raw evidence](evidence/image-allocation-556.json) contains **84 successful trials**:
seven alternating baseline/candidate pairs for each of six scenarios. All input,
RGBA and PNG hashes match across variants and repeats; every source-integrity and
encoding-integrity assertion passes. Baseline is
`73106ef4bfce52af9b788e2a6232253546d815e8`. Candidate was the uncommitted change on
that same base; the raw evidence identifies its compiled converter by SHA-256
`9a0f66a4f15ae70cb1e673e037ee1673e85ae21d3734ceae219ebb30cddd74fd`
(baseline `e55f07113c2924afba460ed3972fcbde8c5b26bf21bf279bac00256f02e80465`).
The run used Linux, Node 24.19.0, an AMD EPYC 9V45 and four available CPU threads,
with other compilers/tests/benchmarks idle. No measurements ran concurrently.

Cells below are **median / observed maximum** of seven trial-level measurements.
The maximum is a descriptive tail, not a reliable population percentile.

| Workload | Variant | Convert ms | PNG encode ms | Convert + encode ms |
|---|---|---:|---:|---:|
| DDS 512² | baseline | 5.664 / 5.996 | 23.401 / 24.425 | 29.286 / 29.876 |
| DDS 512² | candidate | 5.718 / 5.986 | 23.109 / 24.269 | 28.679 / 30.113 |
| TGA 512² | baseline | 4.480 / 4.844 | 23.936 / 24.530 | 28.212 / 29.367 |
| TGA 512² | candidate | 4.357 / 4.691 | 23.503 / 24.638 | 27.545 / 29.201 |
| DDS 2048² | baseline | 52.861 / 55.908 | 335.038 / 369.898 | 388.166 / 424.162 |
| DDS 2048² | candidate | 53.883 / 80.283 | 333.654 / 379.456 | 386.799 / 435.806 |
| TGA 2048² | baseline | 52.815 / 56.616 | 335.271 / 376.653 | 386.646 / 429.468 |
| TGA 2048² | candidate | 48.204 / 53.820 | 330.874 / 351.367 | 379.078 / 403.744 |
| DDS 4096×2048 | baseline | 107.879 / 109.915 | 655.932 / 690.584 | 762.341 / 800.499 |
| DDS 4096×2048 | candidate | 94.968 / 100.156 | 663.050 / 668.898 | 757.844 / 768.876 |
| TGA 4096×2048 | baseline | 107.873 / 109.750 | 662.473 / 668.167 | 769.514 / 777.383 |
| TGA 4096×2048 | candidate | 99.241 / 103.267 | 668.431 / 674.019 | 768.914 / 777.286 |

These timings are mixed and include noise: 2048² DDS conversion's candidate median
and tail are worse, while its total median changes by under 0.4%. Large DDS/TGA
total medians change by under 0.6%/0.1%. PNG encoding dominates total time. There is
no general conversion, decode or editor speed claim.

Converter-phase memory peaks include the retained source and decoder state. All
figures are MiB, median / observed maximum. ArrayBuffers include raster storage
outside the JS heap; external memory in the raw data shows the same broad reduction.

| Workload | Baseline ArrayBuffers | Candidate ArrayBuffers | Baseline RSS | Candidate RSS |
|---|---:|---:|---:|---:|
| DDS 512² | 4.20 / 4.20 | 2.20 / 2.20 | 42.84 / 43.43 | 41.92 / 42.16 |
| TGA 512² | 5.20 / 5.20 | 3.20 / 3.20 | 43.88 / 44.00 | 42.88 / 43.13 |
| DDS 2048² | 64.20 / 64.20 | 32.20 / 32.20 | 87.96 / 88.11 | 71.75 / 72.05 |
| TGA 2048² | 80.20 / 80.20 | 48.20 / 48.20 | 103.75 / 103.88 | 88.00 / 88.13 |
| DDS 4096×2048 | 128.20 / 128.20 | 64.20 / 64.20 | 136.14 / 136.68 | 103.86 / 104.51 |
| TGA 4096×2048 | 160.20 / 160.20 | 96.20 / 96.20 | 168.00 / 168.13 | 136.00 / 136.13 |

The allocation counters confirm **exactly two fewer full-raster allocations** on
every candidate trial: no blank PNG canvas and no decoded-pixel Buffer copy. The
observed converter ArrayBuffer peak falls by approximately twice the raster size:
2 MiB, 32 MiB and 64 MiB for the three image sizes (small sub-KiB bookkeeping
differences remain). A Buffer view retains the required decoder-owned raster.

For 4096×2048 DDS, median ArrayBuffers before conversion are 32.17 MiB on both
variants, then peak at 128.20 versus 64.20 MiB during conversion. Median JS heap
starts around 5.65 MiB and peaks at 6.37 versus 6.72 MiB; this is an external-buffer
allocation improvement, not a JS heap reduction. The TGA decoder also keeps its
own source copy during conversion; that separate allocation is unchanged.

The whole process does not show the same reduction. For large DDS, median sampled
encode RSS is 201.80 versus 216.84 MiB, and median lifetime maximum RSS is 202.91
versus 216.91 MiB; lifetime maxima across the trials are 233.73 versus 233.54 MiB.
Median encode ArrayBuffer peaks are about 160.25 MiB on both. Large TGA sampled
encode RSS is 201.18 versus 201.09 MiB. PNG filtering, compression/output buffers,
garbage collection and residency dominate those later observations. No whole-decode
peak-RSS, retained-memory or whole-app improvement is claimed.

The supported result is narrower: **DDS/TGA conversion avoids two transient raster
allocations and substantially reduces the observed conversion-phase external
memory**, while preserving pixels, PNG bytes, input validation and workers.

After measuring, the required `npm run lint`, `npm run compile-ts` and full
`npm test` checks pass. Both test projects compile; the pure unit suite and 2,411
legacy/webview cases pass, with one existing pending case. No editor integration
or whole-preview performance measurement was performed for this change.
