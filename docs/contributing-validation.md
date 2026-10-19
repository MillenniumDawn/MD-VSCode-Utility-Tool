# Validation guide

Use the Node version in `.nvmrc` (currently 24), then install the locked dependencies with
`npm ci`. The commands below are the same scripts used by the repository's CI workflows; they
check different layers and do not all launch VS Code.

## Fast local checks

```sh
npm run lint
npm run knip
npm run dupes
npm test
```

`npm test` first runs `scripts/compile-tests.js`, which compiles both test TypeScript projects into
`out-test/` and `out-test-webview/`, then runs the unit suite and the other host and jsdom webview
tests with Mocha. It does not launch an editor or a browser. To run one already-compiled suite, use
the matching Mocha command:

```sh
./node_modules/.bin/mocha --forbid-only --require ./out-test/src/test/unit/setup.js \
  out-test/src/test/unit/util/cache.test.js
./node_modules/.bin/mocha --forbid-only --require ./out-test/src/test/_vscode_stub.js \
  out-test/src/test/fileloader.test.js
./node_modules/.bin/mocha --forbid-only --require ./out-test/src/test/_vscode_stub.js \
  out-test-webview/src/test/webview/hovertooltip.test.js
```

Replace the example file with the compiled test you are working on. Run `node scripts/compile-tests.js`
first after changing test or source TypeScript; this is also the `pretest` step run automatically by
`npm test`. Unit tests use their own setup, while the broader host and webview suites load the VS
Code stub. Webview tests use jsdom, not Chromium.

## Types, coverage, and the shipped webview code

```sh
npm run compile-ts
npm run test:coverage
node scripts/diff-coverage.js --base origin/main...HEAD --min 80
npm run package
npm run smoke:webviews
```

`compile-ts` checks the extension's production TypeScript project. `test:coverage` compiles and runs
the normal unit and jsdom suites through c8; thresholds are configured in `package.json`. The
changed-line command checks the generated `coverage/lcov.info` against the named Git base and
requires 80% coverage for executable changed lines. CI uses the pull request merge commit's first
parent (`HEAD^1`) as its base.

`package` builds the installable VSIX, including the production webpack bundles. `smoke:webviews`
evaluates the generated production webview bundles to catch load-time failures; it is a bundle
smoke check, not a browser interaction test. Build the bundles first with `npm run package` (or
`npm run webpack` while developing). `npm run package` also creates a `.vsix` in the repository
root.

## Editor and browser smoke tests

```sh
npm run test:integration
npm run test:web
```

The editor integration runner downloads and launches the pinned VS Code `1.138.0` desktop build
through `@vscode/test-electron`. The browser runner uses Chromium through `@vscode/test-web`, with
its commit pinned in `src/test/integration/runWebTest.ts`; it runs against the browser smoke
fixture. Both runners need their corresponding VS Code or browser build available, so the first
run may download several hundred megabytes. On Linux, the editor runner needs a display server;
CI provides one with `xvfb-run -a npm run test:integration`. No `--no-sandbox` flag is configured
by these runners. Do not add it to a local command unless the runner or environment specifically
requires it and the change is understood.

The editor and browser commands exercise a small integration smoke suite, not the full extension
inside every supported VS Code release or browser. For extension packaging, CI runs lint, Knip,
duplication detection, coverage, changed-line coverage, VSIX packaging, production webview bundle
smoke, editor integration, and browser smoke in that order. See `.github/workflows/test.yml` for
the current workflow.

## Compatibility checks against real mods

```sh
npm run compat -- --mod <mod-directory> [--game <HOI4-install>] \
  [--parent <parent-mod-directory>]... [--only decision,mio] [--verbose]
```

The compatibility runner drives each selected preview's loader and content builder on a real mod.
It can find file names and layouts that hand-written fixtures miss. It does not cover the world map.
`compat/mods.json` pins the mod revisions CI checks, and `compat/baseline/` records known results.
The workflow fails on new compatibility problems compared with those checked-in baselines; an
existing baseline entry is not a claim that the preview works without problems. The fixture-only
compatibility test runs as part of `npm test` and needs no game installation. See
[`compat/README.md`](../compat/README.md) for mod pins, baseline updates, and vanilla manifest
maintenance.

## Continuous integration

Pull requests run the test workflow above. A separate compatibility workflow checks the pinned
real-mod set. Release verification also runs lint and the normal coverage test before packaging;
the exact jobs and conditions live in `.github/workflows/test.yml`, `.github/workflows/compat.yml`,
and `.github/workflows/release.yml`. Passing `npm test` locally therefore confirms the unit and
jsdom suites, but does not by itself confirm VSIX packaging, production bundle loading, the editor
or browser smoke suites, or real-mod compatibility.
