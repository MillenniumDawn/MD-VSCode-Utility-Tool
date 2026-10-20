# Parser and image worker verification

The local change fixes #569's exponential string-token backtracking and #550's
second decode of worker-rejected input. It leaves worker dispatch, timeout policy,
and teardown unchanged. The measurements below are headless subprocess results,
not whole-editor performance claims.

Baseline: utility `73106ef4bfce52af9b788e2a6232253546d815e8`, verified against
remote main on 2026-10-18. The only open PR was #543 (focus-audit responsiveness);
#323 (pending-job teardown and timeouts) was already merged. Neither is duplicated.
The utility checkout and detached baseline worktree are separate from the main mod.
The read-only corpus is Millennium Dawn `532b046fd6fb8c19089a52b4a53b2578816a704d`.

## Reproduce

Use Node 24 and compile the baseline and candidate separately. The saved environment
used Node 24.19.0, Linux, an AMD EPYC 9V45, and four available CPU threads. Both
worktrees used the same lockfile dependencies. Browser installation is unnecessary:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --cache /tmp/md-utility-npm-cache --no-audit --no-fund
node scripts/compile-tests.js
# Also compile tsconfig.test.json in the baseline checkout.
node scripts/bench-parser-image.js parser BASELINE CANDIDATE /tmp/parser.json
node scripts/bench-parser-image.js corpus BASELINE CANDIDATE /tmp/corpus.json MOD
node scripts/bench-parser-image.js image BASELINE CANDIDATE /tmp/image.json
```

Run the suites sequentially without other tests or builds running. Every sample is
a fresh child process, and trials alternate baseline/candidate then candidate/baseline.
The parent watchdog kills and reaps stalled children with SIGKILL; Mocha's timeout
cannot interrupt the original synchronous regex. Corpus progress resets a ten-second
per-file watchdog. Image children have a sixty-second watchdog. Synthetic workers
live in unique temporary directories and are terminated before those directories
are removed. No editor, workspace settings, or mod files are written.

Raw measurements are in [parser.json](../evidence/parser.json),
[corpus.json](../evidence/corpus.json), and [image.json](../evidence/image.json).
The corpus command also writes per-file manifests alongside its output. These large
manifests and local check logs are ignored by Git; the committed corpus summary
retains the combined per-file digest and the failure list.

## Parser

The malformed input is `a = "` followed by backslash pairs, with no closing quote.
Seven trials per variant and input size follow one untimed ordinary parse in each
child. Child launch and module loading are outside the parse timer. The 60-pair
baseline result is censored by the **three-second child watchdog**, which also
includes startup, module loading, and warmup. Its parse duration is unavailable;
the watchdog does not establish a strict three-second lower bound on the parse itself.

| Backslash pairs | Baseline ms, median / max | Candidate ms, median / max | RSS after parse, median MiB (B / C) |
|---|---:|---:|---:|
| 10 | 0.170 / 0.191 | 0.129 / 0.147 | 31.5 / 31.5 |
| 14 | 2.479 / 7.524 | 0.121 / 0.127 | 31.5 / 31.6 |
| 18 | 108.152 / 109.166 | 0.121 / 0.136 | 31.5 / 31.5 |
| 60 | 7/7 child watchdogs; parse duration unavailable | 0.121 / 0.147 | unavailable / 31.6 |

Candidate 60-pair parses reject in a median 0.121 ms (maximum 0.147 ms).
Baseline timings already grow from 2.479 ms at 14 pairs to 108.152 ms at
18 pairs. The 14-pair baseline maximum of 7.524 ms also illustrates scheduler noise.
RSS snapshots cover the completed child process after its parse, including modules;
they are not incremental parser allocation measurements.

The regression test uses the same process boundary with 60 pairs and a three-second
watchdog. It failed safely on baseline and passes on candidate. That loose CI bound
detects a freeze without asserting sub-millisecond scheduling on shared runners.
Valid-string cases include escaped quotes, escaped backslashes, Windows paths,
unknown escapes, a trailing escaped backslash, multiline text, and comment markers.

The alternatives are now disjoint: the escape branch consumes a backslash and its
following character; the ordinary branch excludes both backslash and quote. Escape
value conversion is unchanged. An odd trailing backslash now escapes the following
quote and therefore needs another closing quote. The old pattern could incorrectly
accept that quote as a terminator after backtracking. A test pins the corrected
malformed-input behavior; no file in this corpus changes its result.

The corpus includes every tracked `.txt`, `.gui`, `.gfx`, `.asset`, and `.mod` file,
including non-script text such as `Changelog.txt`. Each successful complete parse
is JSON-serialized with default options, including values and position tokens.
Failures include their error name and full message. A digest is computed per file,
then across the sorted file records; input names and bytes are hashed separately.

All four runs match: **7,715 files, 153,538,599 input bytes, 7,690 successful
parses, the same 25 failures, and zero changed file results**.

| Variant | Parse total ms, median / observed range | Lifetime maximum RSS MiB, range |
|---|---:|---:|
| baseline | 2743.8 / 2704.6–2783.1 | 1659.0–1662.2 |
| candidate | 2766.0 / 2700.7–2831.3 | 1653.2–1660.7 |

Input SHA-256: `03541158a0bc033507e91656437a1193a9813aab228f74a8c3a0fcd22c5cb676`.
Combined result SHA-256: `8f21e17c07c05898813c64d2e724ebe9eb06cbfbb0a11306e4a0599a1757127b`.

Only two corpus trials per variant were needed for parity. Their ranges and memory
are reported for context; they do not establish a throughput or memory improvement.
The corpus parse timer excludes file I/O, hashing, and JSON serialization. Process
lifetime maximum RSS includes those operations and GC high-water effects.

## Images

The tests spy on the synchronous decoder's DDS parse and TGA/PNG conversion
boundaries; workers load separate copies of those modules. On baseline, each of five
bad-input cases reached the synchronous decoder once: truncated DDS/TGA, unsupported
TGA, oversized PNG, and corrupt PNG. On candidate, all five reject as `UserError`
with zero synchronous decodes and zero tool-error logs. Genuine missing-entry worker
startup still falls back once, and a disabled pool keeps decoding. Sixteen queued
timeouts produce no synchronous fallback, leave the pool enabled, and allow a fresh
real worker to decode again. Valid concurrent DDS/TGA/PNG bytes and aligned pooled
source buffers match the synchronous reference.

The benchmark uses deterministic noise pixels with mixed uncompressed DDS and TGA
inputs. It warms each real worker before measuring. Reusing two source buffers
isolates transferred-copy cost from source-cache size; this understates total memory
for a real burst of many unique cached images. Workload timers include dispatch and
completion, but exclude reference PNG decodes, output hashing, and recovery.
Valid outputs are compared byte-for-byte with synchronous references; input hashes
and a subsequent real-worker recovery decode are checked in every trial.

Seven trials per variant and scenario report median and maximum. With seven samples,
the observed maximum is a descriptive tail, not a reliable population p95/p99.

| Workload (input copy volume) | Variant | Complete ms, median / max | Submit ms, median / max | Workload peak RSS MiB, median / max |
|---|---|---:|---:|---:|
| 64 × 512², 4 workers (64 MiB) | baseline | 495.7 / 612.2 | 30.0 / 40.2 | 484.5 / 496.2 |
| 64 × 512², 4 workers (64 MiB) | candidate | 501.0 / 633.1 | 38.4 / 50.4 | 470.1 / 485.5 |
| 32 × 1024², 4 workers (128 MiB) | baseline | 962.4 / 1053.1 | 44.1 / 62.2 | 693.6 / 702.2 |
| 32 × 1024², 4 workers (128 MiB) | candidate | 955.1 / 1055.4 | 39.3 / 56.0 | 679.5 / 727.4 |
| 64 × 1024², blocked 1 worker (256 MiB) | baseline | 160.1 / 160.7 | 46.3 / 50.4 | 324.3 / 325.2 |
| 64 × 1024², blocked 1 worker (256 MiB) | candidate | 157.7 / 161.1 | 47.1 / 51.2 | 323.8 / 324.7 |

In the blocked case, median ready → submitted RSS is **68.9 → 324.3 MiB**
on baseline and **66.4 → 323.8 MiB** on candidate. Submission itself occupies
the main thread for about 46–47 ms median. All 64 jobs reject at roughly
158–160 ms median despite valid queued inputs, because the first timeout evicts
their shared worker. The configured test limit is 150 ms; observed settlement
also includes scheduling and termination overhead.

Valid-workload median differences are about +1.1% and −0.8%, within the observed
run-to-run spread. Peak RSS overlaps and varies by tens of MiB. These results
establish parity and expose queue costs; they do not establish an optimization.

RSS is process-wide, including all worker isolates. `peakRss` is sampled every 5 ms
within the timed dispatch/completion window, plus synchronous samples before and
after submission/completion. Shorter peaks can be missed. `ready` and `submitted`
are snapshots immediately before and after the synchronous submission loop.
`bytesTransferred` counts **input payload only**, excluding returned PNG buffers.
Raw `after` and process-lifetime `maxRssKiB` also include synchronous reference
decodes and recovery; they are not retained-memory or workload-only peak figures.
Main-isolate heap/external/ArrayBuffer snapshots in the JSON do not account for all
worker-owned queued buffers; RSS provides the relevant process-level observation.

The blocked case starts a fresh one-worker pool whose first request blocks inside
`Atomics.wait`. A 150 ms test timeout evicts it and rejects all 64 jobs, including
valid jobs waiting behind it. All 14 trials have zero synchronous fallback, an empty
but enabled pool, and successful real-worker recovery. This verifies existing #323
behavior at a larger queue depth; it does not change that implementation.

The pool bounds threads, while input copies are posted immediately for every job.
Queue growth remains unbounded. Bounded dispatch is deferred: this stress test
demonstrates the memory cost, but a change also needs an explicit queue-wait versus
active-decode timeout policy and representative preview/cancellation workloads.
No valid-decode speed or memory gain is claimed for the error-classification fix;
the valid and timeout benchmarks do not exercise its changed `UserError` branch.

## Checks and independent review

Final headless checks:

- Focused parser/decoder unit tests: **80 passing**.
- Existing image-worker plus graphics-loader tests: **35 passing**.
- `npm run test:coverage`: **906 pure + 2,412 legacy/webview tests passing**;
  one existing pending test. Statement/line coverage 91.16%, branch 87.07%,
  function 91.35%. Both test projects compile successfully.
- `node scripts/diff-coverage.js --base 73106ef4bfce52af9b788e2a6232253546d815e8 --min 80`:
  **5/5 changed source lines covered (100%)**.
- `npm run lint`, `npm run compile-ts`, `npm run knip`, `npm run dupes`,
  `npm run package`, and `npm run smoke:webviews`: **pass**.
  Knip prints two redundant-entry configuration hints. Duplication is 0.53%
  across 16 clones. The web bundle prints three size/performance warnings.
- `git diff --check`: **pass**. Remote main rechecked after validation: unchanged.

The first aggregate run exposed a stale graphics-loader test that expected a
truncated TGA to be logged as a tool failure. It now checks quiet `UserError`
handling, and a separate injected unexpected decoder error proves genuine errors
are still logged. The affected focused tests and complete coverage suite were
rerun successfully. No test was skipped or weakened to make the suite pass.

Desktop/browser editor integration tests were not run: this environment has no
`xvfb-run`, and browser downloads were deliberately omitted. No visible VS Code
windows were opened. Production packaging and the JSDOM webview-bundle smoke tests
passed. There is no manual editor/UI verification or whole-app performance claim.

Independent Sol review found no actionable source correctness, regression, or
test-isolation issues. The final review independently reran all 115 focused tests
and recomputed the raw-data invariants and summaries. Its minor report finding was
fixed: the three-second watchdog covers the child's startup as well as its parse,
so it cannot establish a strict three-second lower bound on parse duration. Other
caveats distinguish workload RSS from process-lifetime RSS and input bytes from
total transfer traffic. No source findings remained.
