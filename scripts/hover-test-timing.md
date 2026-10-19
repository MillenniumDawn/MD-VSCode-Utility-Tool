# Hover tooltip test timing

The `hovertooltip.test.ts` suite passed all seven tests in each of seven alternating baseline and
candidate pairs. The change replaces wall-clock waits in this test file with a controlled clock.
These numbers describe test execution only; they do not measure extension or preview performance.

| Measurement | Baseline (`73106ef`) | Candidate (`95183ce`) |
| --- | ---: | ---: |
| Mocha suite duration, median (tail max) | 970 ms (976 ms) | 19 ms (23 ms) |
| Fresh-process wall time, median (tail max) | 1,346.902 ms (1,373.630 ms) | 396.529 ms (462.957 ms) |

Each run launched Node and Mocha in a fresh process and measured wall time around that process.
The baseline is the `origin/main` revision used for this task; the candidate is the hover test
change before this evidence was added. Both ran with Node `v24.19.0` on an AMD EPYC 9V45 machine.
The raw seven-pair results, including per-run test duration and process max RSS, are in
[`evidence/hover-568.json`](evidence/hover-568.json). RSS measurements are retained as raw data;
they do not support a memory improvement claim.

To repeat the comparison, compile tests in both checkouts first, then run from the candidate tree:

```sh
node scripts/compile-tests.js
node scripts/bench-hover-test.js /path/to/baseline /path/to/candidate /tmp/hover-568.json
```

The driver alternates execution order for seven pairs, verifies that each run passes all seven
tests, records suite and fresh-process time plus max RSS, and writes the JSON results after each
run. Temporary process-memory instrumentation is removed on exit. These scripts and evidence are
under `scripts/`, which `.vscodeignore` excludes from the installable extension.
