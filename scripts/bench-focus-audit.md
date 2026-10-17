# Focus audit benchmark

Run `node --expose-gc scripts/bench-focus-audit.js` with `MD_FIXTURE` pointing at a Millennium Dawn checkout. Compile first with `node scripts/compile-tests.js`. This is headless and uses the existing test host, not a VS Code window.

For the measured corpus, check out MillenniumDawn/Millennium-Dawn at `bcbf8ed2ef59ad58068feecaea68bff1c06c2552`: all 114 `common/national_focus/*.txt` files, 29,675,918 bytes. Each run records every file's SHA-256 so modified fixtures are detectable.

To reproduce a before/after comparison, create a separate checkout of this repository at `85aeb62d1c2cad32654dac487acbc335fbcbedaf`, install its dependencies (`npm ci --ignore-scripts`) and run `node scripts/compile-tests.js` there too. From the changed checkout:

```sh
# Set these to your two public checkouts.
export MD_FIXTURE=/path/to/Millennium-Dawn
export BASELINE_SOURCE=/path/to/utility-baseline/out-test/src
for trial in 1 2 3; do
  BENCH_SOURCE_DIR="$BASELINE_SOURCE" BENCH_KEEP_TOKENS=1 \
    node --expose-gc scripts/bench-focus-audit.js > "baseline-$trial.jsonl"
  node --expose-gc scripts/bench-focus-audit.js > "changed-$trial.jsonl"
done
```

Do not time alongside compilation/tests. Each process measures one first invocation (sample 0) and three warm invocations (samples 1–3). Collection follows parsing, so sample 0 is not cold application startup. Sources are preloaded and OS caches are uncontrolled, not cold. The synchronous parse loop measures CPU demand, not the production bounded queue's responsiveness. The benchmark uses the async collector when available, and the original sync collector on the baseline. `BENCH_KEEP_TOKENS=1` models the original audit; the default models token-free audit parsing. No source is patched by this runner.

`ms` excludes explicit GC, heartbeat draining and report formatting. `maxHeartbeatGapMs` is the largest observed interval of a 5-ms timer, not a latency percentile or a guaranteed bound. `heapAfterGC` is retained heap at the phase endpoint, not peak allocation. RSS is also an endpoint; neither is a leak test. CPU time may include parallel runtime/GC threads. Compare `reportSha256` on every invocation before interpreting performance.

## Local implementation validation, 2026-10-16

Node v24.19.0, Linux x86-64. Three processes each, nine warm samples per version:

| Metric | Original | Changed (#537–539) |
|---|---:|---:|
| Collection median | 465.19 ms | 372.33 ms |
| Collection range | 444.15–532.91 ms | 330.83–399.95 ms |
| Median maximum heartbeat gap | 465.36 ms | 22.87 ms |
| Post-parse retained heap median | 95.25 MB | 84.98 MB |
| Parse+conversion median (CPU-demand loop) | 636.45 ms | 596.81 ms |

First collection calls: original 557.79/590.55/590.42 ms; changed 466.88/441.87/442.06 ms. All report hashes remained `cf3a02d25b1ac178f9c61dc3bb33ab625c565d4b7d65ad44ed042ab08337cf4a`.

A row-bucket candidate for #540 was also tried but **not retained**. After initial separate-process runs, 12 alternating same-process pairs compared original and candidate schema implementations on the same parsed corpus. Two preceding pairs warmed both implementations. The median paired saving was only 3.05 ms; 8/12 pairs improved, with deltas from -104.33 to +80.88 ms. That noise does not justify the extra code. This does not establish that overlap validation cannot be optimized.

The regression suite covers cancellation before collection, after file work units, before final return, after listing/read, during collection, and during document opening; a configuration change across a yield; and baseline golden report order/RNG consumption with mixed donors, missing/empty/duplicate IDs, cycles, conditions on/off and both token modes. Preview parsing keeps navigation tokens.
