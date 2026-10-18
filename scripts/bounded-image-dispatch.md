# Bounded image dispatch investigation

**No production queue change is justified under the current compatibility constraints.**
Posting one request per worker reduces the native queue depth, but preserving input
snapshots retains the same queued bytes on the host. The blocked 256 MiB case still
reaches about 325 MiB RSS. Deferring the copies would change successful-worker results
when a caller mutates its input before dispatch. The earlier parser and `UserError`
fixes remain intact.

This follow-up uses `3cd7aac28cedb4c37e39dbe052f26f7d4f3fd3e5` as its production
baseline. Remote main remained `73106ef4bfce52af9b788e2a6232253546d815e8` on
2026-10-18, so there was no intervening queue fix. The prototype is confined to
[image-dispatch-experiment.js](image-dispatch-experiment.js), tests, and the benchmark
driver; production decoder code is unchanged. `scripts/**` and `evidence/**` are
excluded from the VSIX. Inspecting the package exposed the need for the evidence
exclusion: earlier local logs/manifests would otherwise be included.

## What the candidate does

The benchmark-only adapter retains the decoder's already copied private snapshots
and posts at most one request per worker. A response releases the next snapshot in
that worker's FIFO. Existing worker assignment, pending jobs, timers, timeout
collateral rejection, synchronous fallback and recovery remain in the decoder.
Thus this experiment bounds messages delivered to a worker, while retaining the
snapshot allocation at submission. It does not implement new admission, cancellation,
ownership or storage policies, and it is not wired into the extension.

The deterministic tests control worker responses and timers without sleeping:

- Saturated inputs preserve their successful-worker snapshot after caller mutation.
- Two workers preserve their own FIFO and correctly route interleaved completions.
- `UserError` does not retry synchronously or prevent later queued work.
- Every deadline is registered at submission, including jobs waiting behind another
  job. A timeout rejects worker-scoped collateral jobs, clears timers and allows recovery.
- Disposal settles active and queued callers through the existing synchronous fallback.
- Startup errors and exits without an error settle queued work and clear timers.
- The existing startup fallback reads the original source at fallback time; it has
  not been changed to apply successful-worker snapshot semantics universally.

Initial and deferred native post exceptions also settle only the failed job, keep
the pool enabled, continue FIFO work, and leave no uncleared timer. All ten
contracts run against both production dispatch and the experiment:
**20 deterministic tests**. Actual real-worker invalid-input, startup, timeout and
recovery checks from the preceding change also remain in the complete suite.

## Paired measurements

```sh
# Compile the baseline and candidate test projects first; use the same dependencies.
node scripts/bench-parser-image.js dispatch BASELINE CANDIDATE /tmp/dispatch.json
```

The `dispatch` mode applies the same instrumentation to both variants. Baseline
posts immediately; candidate uses the bounded adapter. The compiled production
decoder is identical in both. There are seven AB/BA alternating pairs per workload,
each in a fresh process, with the same 512/1024-pixel noise DDS/TGA inputs and warmup
as the prior image benchmark. The 42 trials ran sequentially without tests/builds
running alongside them. Hardware: Linux, Node 24.19.0, AMD EPYC 9V45, four available
CPU threads. [Raw results](../evidence/dispatch.json) retain every sample.

A common worker-entry wrapper atomically records each decode's start in shared
memory. Queue latency runs from the host's post/enqueue call, after its input copy,
to actual handler entry. This includes native or host waiting and any cold startup
in the blocked scenario. Total latency runs from batch submission through settlement
of all callers. Completed and never-started jobs are reported separately. No timeout
was extended to compensate for queueing: the blocked case retains the 150 ms test
deadline, including wait time, and rejects the same 64 jobs on both variants.

| Workload | Variant | Total ms, median / max | Submit ms, median / max | Workload peak RSS MiB, median / max |
|---|---|---:|---:|---:|
| 64 × 512², four workers (64 MiB snapshots) | baseline | 488.6 / 511.9 | 30.8 / 38.3 | 474.3 / 494.7 |
| 64 × 512², four workers (64 MiB snapshots) | candidate | 479.0 / 540.0 | 35.7 / 41.4 | 475.6 / 507.7 |
| 32 × 1024², four workers (128 MiB snapshots) | baseline | 915.9 / 994.4 | 54.1 / 62.7 | 690.4 / 706.5 |
| 32 × 1024², four workers (128 MiB snapshots) | candidate | 934.1 / 973.5 | 50.0 / 71.6 | 679.3 / 699.5 |
| 64 × 1024², blocked one worker (256 MiB snapshots) | baseline | 159.9 / 160.8 | 49.3 / 122.6 | 324.6 / 325.2 |
| 64 × 1024², blocked one worker (256 MiB snapshots) | candidate | 152.5 / 152.8 | 53.0 / 137.3 | 324.8 / 325.0 |

| Workload | Variant | Decode-start queue ms, median / max | Job completion ms, median / max | Never-started wait ms, median / max |
|---|---|---:|---:|---:|
| 64 × 512², four workers (64 MiB snapshots) | baseline | 218.1 / 455.6 | 268.7 / 511.9 | none |
| 64 × 512², four workers (64 MiB snapshots) | candidate | 215.9 / 476.0 | 265.2 / 540.0 | none |
| 32 × 1024², four workers (128 MiB snapshots) | baseline | 378.9 / 863.9 | 515.8 / 994.4 | none |
| 32 × 1024², four workers (128 MiB snapshots) | candidate | 390.3 / 809.1 | 515.7 / 973.5 | none |
| 64 × 1024², blocked one worker (256 MiB snapshots) | baseline | 21.0 / 22.1 | 159.9 / 160.8 | 133.5 / 158.4 |
| 64 × 1024², blocked one worker (256 MiB snapshots) | candidate | 20.4 / 22.4 | 152.5 / 152.8 | 123.8 / 150.2 |

Blocked case median snapshots: baseline: ready RSS 64.8 → submitted 324.6 MiB; candidate: ready RSS 64.8 → submitted 324.5 MiB.

The two valid-workload median totals change by approximately −2.0% and +2.0%.
Both directions are small against the observed trial spread. Blocked candidate
settlement is roughly 7 ms earlier, while input memory stays unchanged; moving
snapshot ownership can change cleanup/scheduling overhead without removing bytes.
One outlier submit loop reaches 122.6 ms on baseline and 137.3 ms on candidate.
The normal medians are 49.3 and 53.0 ms. No improvement claim is based on that noise.

Each total/submit/peak-RSS cell is the median and maximum of seven trial-level
measurements. The queue/job-latency table pools the job observations from those
trials; its descriptive medians and maxima are correlated within each trial and are
not population percentile estimates or confidence intervals. RSS samples include
all isolates and the interval before/after the synchronous submit loop, plus a 5 ms
sampler during work. Shorter peaks can be missed. Lifetime RSS and `after` fields
also include synchronous reference decoding and recovery, so they are not used as
workload-only peaks or retained-memory estimates.

`inputSnapshotBytes` is admitted input snapshot volume, **not bytes actually posted**.
In the blocked case the baseline posts 64 snapshots and the candidate posts one;
both retain all 64 snapshots until settlement. In each trial only one job starts;
the other 63 remain queued and fail with their worker. `neverStartedWaitMs` measures
their wait until rejection, rather than inventing a decode-start latency. All valid
trial outputs match synchronous reference PNGs and have identical output hashes
across variants. Every trial preserves sources, has zero synchronous worker fallback,
and successfully decodes again with a real worker.

## Decision

The snapshot-preserving experiment does not solve queued-copy growth. Its small mixed changes in
valid-workload timing/RSS do not justify adding a production scheduler. There is no
claim of a whole-editor gain. An arbitrary input can contain incompressible data;
preserving each submitted version still requires retaining those bytes somewhere.
Repeated-buffer deduplication would need mutation detection and would not bound a
burst of unique images.

A real memory bound needs an explicit choice before further implementation:

- Require inputs to remain immutable until settlement, allowing deferred snapshots.
- Limit admissions and reject/defer excess calls under an agreed API policy.
- Change snapshot ownership or storage, with the corresponding compatibility and
  latency tradeoffs.

The experiment demonstrates the tested contracts, rather than universal failure-timing
equivalence: a deferred native post exception is discovered only when its queued
request is attempted. Its per-job failure is routed through the existing error
response path; it does not mark a healthy worker as crashed. This is another reason
not to treat the test adapter as a production replacement.

No such policy was silently introduced. No user setting, timeout duration, API,
production completion order or worker recovery behavior changed in this follow-up.

## Validation and limits

- **20 new deterministic dispatch tests**, run in both production and experiment modes.
- **100 focused unit tests** (parser, decoder, dispatch) and **35 image/graphics tests** pass.
- Complete `npm run test:coverage`: **927 pure + 2,412 legacy/webview tests pass**;
  one existing pending test. Statements/lines **91.21%**, branches **87.10%**,
  functions **91.40%**. Both test projects compile.
- Lint, application type compilation, Knip, duplication checks, production VSIX
  packaging and JSDOM webview-bundle smoke checks pass. Knip prints two redundant
  entry hints, duplication remains 0.53% across 16 clones, and webpack prints its
  three bundle-size/performance warnings.
- Package inspection confirms zero `scripts/` or `evidence/` entries after exclusion.
- Changed-source coverage against the original `73106ef` base: **5/5 lines (100%)**.
- `git diff --check` passes. A local bundle is delivered against that original base;
  its restoration/tree verification and SHA-256 are included in the final handoff.

Independent Sol review confirmed the snapshot constraint, checked the 42 raw-data
invariants and measurement tables, and found one adapter-only failure-path bug:
initial native post exceptions were being turned into worker crashes before the
caller registered its timer. The adapter now propagates initial throws normally;
deferred throws reject only their own job via a microtask response and continue
FIFO. Two controlled throw tests per mode were added, and focused plus aggregate
checks were rerun. Production was unaffected by that experiment bug.

Final independent Sol review confirmed the fix and reran **28 dispatch/decoder
tests**, including all 20 new contracts. No actionable findings remain. The exception
fix is outside the measured successful/timeout paths, so it does not require
repeating those benchmark trials. No artifact was uploaded.

Desktop/editor browser integration **was not run**. Exact observed missing prerequisites:

- Neither `xvfb-run` nor `Xvfb` is installed, and `DISPLAY` is unset.
- The pinned desktop VS Code **1.138.0** has not been downloaded; `.vscode-test` is absent.
- The pinned web VS Code build **2a59476c9bfcb90b3ddc372c36762471b7dfad1c** has not
  been downloaded; `.vscode-test-web` is absent.
- Playwright's expected Chromium executable
  `/home/agent/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` is absent.
  Browser installation was deliberately skipped for this headless work.

Other editor runtime prerequisites were not validated in the absence of those
binaries. No editor windows were opened, and packaging/JSDOM smoke results do not
stand in for editor integration.
