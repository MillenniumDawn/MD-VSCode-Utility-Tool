# Dependency marker scanner measurements

Issues #576 and #546. Current main `73106ef4bfce52af9b788e2a6232253546d815e8`
was compared with this branch's compiled scanner. The raw evidence records both compiled
module hashes because the candidate was measured before its commit. This is a scanner
microbenchmark, not an extension responsiveness measurement.

Run after compiling `tsconfig.test.json` in both checkouts:

```sh
node scripts/bench-dependency-markers.js BASELINE CANDIDATE OUTPUT.json [READ_ONLY_MOD]
```

The driver runs seven pairs per scenario, alternating AB/BA order. Every scan runs in a
fresh Node child process with a parent watchdog; regex work is synchronous and Mocha's
timeout cannot interrupt it. Only the scanner call is timed, after a small ordinary-marker
warmup. Fixture creation, module loading, GC and process startup are outside that interval.
No other builds, tests or benchmarks ran during measurement. Node 24.19.0, Linux x64,
AMD EPYC 9V45 96-Core Processor; shared-host scheduling remains a source of noise.

| Fixture | Baseline median / maximum ms | Candidate median / maximum ms |
|---|---:|---:|
| `#!event:` plus 8,000 colons | 24.516 / 25.329 | 0.011 / 0.013 |
| Same, 32,000 colons | 383.105 / 394.145 | 0.028 / 0.083 |
| Same, 100,000 colons | 3,738.361 / 4,020.070 | 0.070 / 0.128 |
| 10,000 valid marker lines | 2.445 / 3.201 | 2.295 / 2.647 |

All 56 scans completed within the watchdog; corresponding output hashes matched.
The malformed-case growth reproduces the repeated backtracking problem. The line-bounded
candidate avoids overlapping colon candidates. Sub-millisecond candidate timings have
limited precision; the ordinary-marker difference is too small and noisy for an application
performance claim. Seven observations support a maximum observed sample, not a reliable p99.

Peak process RSS was effectively unchanged for malformed scans (median about 40 MiB for
both variants). For the valid fixture, median / maximum RSS was 45.023 / 45.695 MiB baseline
and 43.652 / 43.852 MiB candidate. These include the runtime and imported modules, and do not
establish a whole-extension memory improvement. Raw evidence also contains before/after
heap, external memory and ArrayBuffer snapshots.

A read-only scan of Millennium Dawn revision `532b046fd6fb8c19089a52b4a53b2578816a704d`
covered 10,814 tracked `.txt`, `.gfx`, `.gui`, `.asset`, `.mod` and `.yml` files,
458,971,865 bytes. Neither variant found a dependency marker, so their output hashes match;
this is weak corpus evidence for valid marker behavior. The synthetic valid-marker fixture
and regression cases cover declaration order, path colons, slash normalization, final
extensions, case sensitivity, Unicode line separators and the intended trailing-space/tab change.

Before the fix, the new focused regression suite had two passing and four failing tests:
the adversarial child was killed by its two-second parent watchdog, and three whitespace
variants were dropped. After the fix all eight passed, including two added Unicode line-separator parity cases. The corrected existing whitespace
test and the other 25 legacy dependency tests passed as well.

Raw trials: [`evidence/dependency-markers-paired.json`](evidence/dependency-markers-paired.json).
The optional corpus is read-only; children are killed/reaped on timeout and exit. The driver
does not create editor windows or modify settings.
