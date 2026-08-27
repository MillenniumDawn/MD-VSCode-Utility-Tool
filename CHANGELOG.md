v1.1.30

  Functionality:

- [ CI ] Ask extension questions in the issue templates instead of mod questions.
- Flag misplaced shared and joint focuses in the tree that merges them in. Issue #146.
- workflow.
- Update task.yml.

v1.1.29

  Functionality:

- Recover from an index build that fails or overruns instead of hanging on it.
- Keep the editor responsive while indexing, and show progress you can cancel.
- Keep a separate index cache per mod, and reuse the parts of it that are still current.
- Speed up previews and indexing, and remove the duplicated index and preview scaffolding.
- [ Focus Tree ] Run layout validation on shared and joint focus trees. Issue #82.
- Focus tree and idea previews no longer crash when a container element is missing.
- [ Focus Tree ] Share the focus tree preview's update machinery with every other preview. Issue #140.
- [ CI ] Run the test suite on the release pull request.
- Share the graph, search and toolbar code the decision, event and idea previews each had a copy of. Issue #139.
- [ Focus Tree ] Fix joint-focus layout warnings not reaching the live previewer.

v1.1.28

  Functionality:

- Fix a joint focus branch vanishing while its file is edited, and a false prerequisite warning on a mutually exclusive row. Issue #126.
- [ Focus Tree ] Shift+click a focus to isolate its prerequisite lines. Issue #127.

v1.1.27

  Functionality:

- Preview a decisions file as a graph of categories, decisions and missions. Issue #123.

v1.1.26

  Functionality:

- Opening a `common/ideas` file now previews every idea as a card, grouped by category, showing the idea's icon, cost, traits, modifiers and `allowed`/`available` conditions. Ideas that swap into one another are drawn as a chain of cards joined by arrows, and clicking an arrow opens the file that performs the swap. Issue #5.
- [ Event Tree ] Show what an event's after block does in the event preview.

v1.1.25

  Functionality:

- Filter the event preview by kind, and say what each event is. Issue #117.

v1.1.24

  Functionality:

- [ Event Tree ] Hovering an option now shows what it does, and hovering an event shows the effects it runs immediately. Effects under an `if` or inside a `random_list` are listed under the condition or the weight that decides them. A small dot in the corner of a box marks the boxes that have any.
- [ Event Tree ] Two more toggles: `Show event picture` turns the picture that appears when you hover an event on and off, and `Show effects` does the same for the effect panel. Both start on, and your choices are remembered like the other toggles.
- [ Event Tree ] You can now drag the preview around with the mouse, the way the focus tree preview already works: press anywhere on the empty canvas and move, and the chain follows the cursor. Hover panels stay out of the way until you let go.
- [ Event Tree ] A search box in the toolbar finds an event by its id or its title. Matching events are highlighted where they are, nothing moves, and `Enter` jumps to each match in turn — `Shift+Enter` walks back. The counter next to the box says how many matches are on the canvas.
- [ Event Tree ] A new `Only event chains` toggle hides every event that does not lead to, or come from, another event. Events that are part of a chain keep all of their options, including the ones that lead nowhere. It starts off.
- [ Event Tree ] The toolbar no longer offers a toggle that cannot do anything for the file you have open. `Show localisation` is gone when the localisation index is off, `Show event picture` when none of the events have a picture, and the same for `Show effects`, `Show hidden & immediate` and `Only event chains`.

  Bugfixes:

- [ Event Tree ] Events in the preview no longer land on top of each other. An event whose trigger panel is open is taller than the events it leads to, and the extra height was not reserved, so it covered whatever was beside it — which is why the preview looked worst with `Show triggers` and `Show event conditions` on. Overlapping is now impossible whatever the toggles do.
- [ Event Tree ] An event can no longer be drawn above the top of the preview, where the toolbar hid it.
- [ Event Tree ] The labels on the arrows now sit in a lane of their own, which widens to fit the longest condition, so a label never covers an event box. Two labels between the same pair of columns are spread apart instead of printed on top of each other.
- [ Event Tree ] An arrow leaving an event with many calls now starts on the event box instead of below it.
- [ Event Tree ] The hovered event picture is now drawn at the zoom level of the preview, instead of always at full size next to a zoomed-out event box.
- [ Event Tree ] The preview toolbar is tall enough for its own contents again: the search box, the toggle labels and the checkboxes are no longer cut off along the bottom. The toggles also sit closer together, so more of them fit before the strip has to scroll.
- Stop drawing the red line under the exclusive link, and reuse it for MIO.

v1.1.23

  Functionality:
  
- [ CI ] Releasing no longer depends on remembering the version bump. A merge to `main` that changed anything outside documentation and CI now opens a release pull request by itself, carrying the version bump and a `CHANGELOG.md` section with one bullet per pull request released since the last version. Reword those bullets, merge, and the extension is published.
- [ CI ] Merging several pull requests in a row now publishes once instead of once each. The release pull request stays open and collects every merge that lands after it, and nothing reaches the marketplace until you merge it. A branch that bumped the version itself is collected the same way rather than publishing on its own.
- [ CI ] A pull request that leaves the version alone now passes the version check without a comment, because that is the normal way to work. It only gets a note when a branch touched the version and got it wrong.
- [ CI ] A push to `main` that only touched documentation or CI files no longer fails the release workflow for having nothing to publish.
- [ MIO ] Two mutually exclusive traits on the same row are now linked with the game's own arrows and line, the way the focus tree already draws them, instead of a red line. A pair that is not on the same row keeps the plain line.

  Bugfixes:

- [ Focus Tree ] The red line between two mutually exclusive focuses is gone. It was still being drawn over the arrows and line that replaced it, which is why the link looked like it sat below a stray red line.
- Always log focus parse failures, including non-Error throws. Issue #99.

v1.1.22

  Functionality:

- [ Event Tree ] The event preview now draws an event chain as a workflow diagram instead of a grid of boxes, and shows the conditions that decide which way a chain goes. Issue #4.
- [ Event Tree ] Four toggles in the preview toolbar: show localisation, show triggers, show event conditions, and show hidden & immediate events. Your choices are remembered.
- [ Event Tree ] Large event files open quickly. An event that several other events lead to is drawn once instead of being copied for every route into it.

  Bugfixes:

- [ Event Tree ] A group of events that only trigger each other now shows up instead of an empty preview.
- [ Event Tree ] Events fired inside an indexed variable scope, such as `var:influence_array^0`, are no longer missing from the chain.
- [ Event Tree ] Conditions on the arrows now read correctly. A negated or counted condition used to be shown as a plain list, which said the opposite of what the file does.
- [ Event Tree ] A `random_list` chance is now labelled a weight rather than a percentage, because that is what the number in the file is: a 3 next to a 1 means three chances in four, not 3%.
- [ Event Tree ] Turning off hidden events no longer removes events that are still reachable a normal way.
- [ Event Tree ] A call guarded by a condition inside a `random_list` no longer looks unconditional, and two calls to the same event that differ only in delay or weight are no longer merged into one arrow.
- [ Event Tree ] `FROM` now resolves to the event that actually fired the call, and an event reached from several places is placed to the right of all of them instead of getting a backwards arrow.
- [ Event ] An empty or comment-only localisation file no longer blanks the preview.
- [ Security ] Text taken from the workspace is escaped before it is written into the preview page, so a value containing `</script>` cannot break the page.
- [ Accessibility ] The preview toggles report the right state to a screen reader as soon as the preview opens.
- [ Cleanup ] The files this change touches no longer emit `any` type warnings, taking the repository from 62 lint warnings to 51.

v1.1.21

  Bugfixes:

- [ CI ] A merge to `main` that forgets the version bump now fails the release workflow instead of reporting success while publishing nothing. The version check compares `package.json` against the existing tags and, when the tag is already present, every remaining step was skipped -- so the run went green in about ten seconds having built no VSIX, published nothing and created no release, with only a `::warning::` buried in the log to say so. Eight consecutive merges landed that way after v1.1.19 (issues #42, #43, #44, #49, #56, #73, #75 and #80), and all eight sat unreleased until v1.1.20 finally carried a bump. The check now emits `::error::` and exits non-zero, so the branch protection status is red and the failure is visible from the commit list. With the skip path gone, the `should_release` output and the ten `if:` guards that depended on it are removed: the job now either publishes or fails. The consequence is that every push to `main` must carry a version bump, including a documentation- or CI-only change.

v1.1.20

  Functionality:

- [ Focus Tree ] The link between two mutually exclusive focuses is now drawn with the game's own textures instead of a flat red border, composed the way `national_focus_exclusive_item` in `nationalfocusview.gui` composes it: the `GFX_focus_exclusive_line1` strip tiles horizontally between the two focus boxes, and the three `GFX_focus_link_exclusive` frames ride on top of it as the left arrow, the centre icon and the right arrow. The link is sized from focus box edge to focus box edge rather than centre to centre, matching the game's own insets. Only a pair that shares a row is textured; any other pair keeps the existing L-shaped corner connection, which draws borders on two edges of a tall box and where a horizontal texture would be wrong -- and which the layout validator already reports as a mistake. Where both halves of a pair declare the exclusivity, the two identical connections are collapsed to one, since the textures are semi-transparent and would otherwise composite over themselves; the branch visibility classes are carried across, so the link still appears and disappears with its branch. If the textures cannot be resolved -- no install path configured, or a mod that redeclares the sprites without shipping a texture -- and on the structure-only render pass that runs before icons are resolved, the previous plain red line is drawn instead. Issue #62.
- [ Performance ] The shared focus index is built on the first lookup that needs it instead of at activation. Registering it kicked off the full global and workspace index build unconditionally, so every workspace matching the extension's activation patterns paid the build cost even if no focus tree was ever opened; such a session now does no focus index work at all. The build is memoized behind a single promise, so concurrent first lookups share one in-flight build rather than starting several, and the status bar spinner, the completion notification and the telemetry event moved with the build so they fire when it actually runs. Workspace file-event handlers stay inert until a build has started, which is safe because the build reads current file state and therefore covers everything that happened earlier. The on-disk cache layer is untouched, so the first preview opened in a cached workspace stays cheap. Issue #43.
- [ Performance ] The GFX and localisation indexes are now built lazily as well, on the same pattern. Registering them only wires up the file watchers; the build, its status bar message, the completion notification and the telemetry moved into a memoized builder that the first lookup starts and that concurrent lookups share, and the watcher handlers stay inert until a build has begun. A session that never resolves a sprite or a localisation key therefore does none of that work. Reaching the build from the lookups made the localisation readers asynchronous, so `getLocalisedText` and `getLocalisedTextQuick` and their call sites -- the instant text box widget and the focus tree, event, MIO and technology content builders -- are now awaited, with the MIO option, tree header and folder option renderers gathering their results through `Promise.all` the way those files already did elsewhere. Behaviour with the feature flag off is unchanged. Issue #80.
- [ Focus Tree ] `shared_focus` and `joint_focus` blocks that hold nested `focus = { ... }` children are now read. `FocusDef` had no `focus` field, so the children were dropped and the whole block collapsed into a single position-less pseudo focus; separately, `focus_tree`'s own `shared_focus` key used the plain string schema, so the block form `shared_focus = { SH_a SH_b }` converted to undefined for every occurrence -- the same lowercase-key gap as the `OR` blocks fixed in v1.1.18. A container block is now unwrapped recursively into its children and contributes only those children, never itself, while a block with no children still parses as a single focus, so every flat definition -- which is every shared and joint focus in Millennium Dawn today -- behaves exactly as before. A `shared_focus` reference is accepted in both the repeated-symbol and the block form for dependency resolution and for the condition merge. Issue #73.

  Bugfixes:

- [ Focus Tree ] The mutually exclusive layout check asserted a rule the game does not have, and flagged correct trees because of it. It required both halves of a `mutually_exclusive` pair to sit on the same X column, but the standard layout places the two alternatives side by side on one row, two columns apart, and resolves the branch afterwards -- `allow_branch` hides the loser and a triggered `offset` slides the survivor into the vacated slot. On the Millennium Dawn United Kingdom tree alone that produced 31 warnings, every one of them a false positive, on pairs such as `ENG_AS90` / `ENG_M270` and `ENG_challenger_3` / `ENG_mgcs_program`; they drowned out the 17 real overlap warnings in the same file. The check now requires the pair to share a *row* instead, which is what the game actually depends on: the exclusivity marker is drawn as a horizontal link between the two focuses, so a pair split across rows is the case that renders wrong. Differing X no longer warns at any distance. The check is unchanged otherwise -- it still resolves positions through the whole `relative_position_id` chain, still ignores `offset` blocks and focuses from other files, still reports a pair once when both halves declare the exclusivity, and still names both ends so each gets its on-canvas marker.
- [ Performance ] Focus tree inlay references are resolved through a lookup map built once per render instead of a linear scan of every inlay per reference, taking the cost of `resolveInlaysForTree` from the product of reference count and inlay count down to their sum on every focus tree render. The shared `arrayToMap` helper was deliberately not used here: it keeps the last value for a duplicate key while the scan it replaces returned the first match, so the map is built with a first-wins guard and a tree with duplicate inlay ids resolves exactly as it did before. A reference that matches nothing still takes the existing warning path. Issue #44.
- [ World Map ] A cast in the world map's open-file command defeated the compile-time check on localisation keys. Written as `localize('worldmap.openfiletype.' + type as any, type)`, the cast bound to the whole concatenated string rather than to `type`, so the typed key parameter was erased and a renamed or deleted `worldmap.openfiletype.*` key would still compile and only surface as a missing string at runtime. The key is now taken from a record keyed by the file-type union whose values are the literal key strings, so the compiler sees the literal union again and removing any of those keys fails the build at the call site. The strings shown are unchanged. Issue #49.
- [ World Map ] The world map now decides what changed by comparing content hashes instead of deep-comparing every item. `sendDifferences` ran a `lodash` `isEqual` per element across all seven item lists on every debounced change, and province objects carry an `edges` array holding a path point array per border, so a Hearts of Iron IV-scale map deep-compared tens of thousands of provinces on every relevant edit. Each item is now serialized once and hashed with two independent 32-bit FNV-1a passes -- 64 combined bits, so a collision quietly swallowing a real change is not a practical concern -- and the result is cached by object identity in a `WeakMap`. A list that comes back as the same array reference short-circuits on a single identity check, which is the common case: a sub-loader whose dependencies did not change returns its cached result untouched, so editing a states file skips the province sweep entirely, and item objects that survive into a rebuilt list keep their identity and therefore their cached hash. The 30-message abort threshold stays cumulative across all seven lists exactly as before, and the cheap scalar comparisons (warnings, continents, terrains, resources and the count fields) are unchanged. Issue #42.

  Cleanup:

- [ Build ] Cleared the three `npm audit` advisories that remained in the test-runner chain, without the downgrade `npm audit fix --force` proposes. mocha 11.8.0 -- the latest stable, and what the existing `^11.1.0` range already resolves to -- still declares `diff ^7.0.0` and `serialize-javascript ^6.0.2`, both inside the vulnerable ranges of GHSA-73rr-hh4g-fpgx, GHSA-5c6j-r48x-rmvq and GHSA-qj8w-gfj5-8c6v, and npm's suggested fix was to drop mocha back to the 2021-era 8.1.3 line. A scoped `overrides` block now pins mocha's transitive `diff` to `^8.0.3` and `serialize-javascript` to `^7.0.5`, the latter deduplicating with the copy `copy-webpack-plugin` already pulls in. mocha's only use of `diff` is `createPatch` in its base reporter, whose API is unchanged across those major versions, and it never imports `serialize-javascript` directly. `npm audit` now reports no vulnerabilities. Issue #75.
- [ Testing ] The `vscode` test stub gained the webview APIs, unblocking the preview manager for unit testing. Importing `previewmanager.ts` threw a `TypeError` under mocha because the stub had neither `registerWebviewPanelSerializer` nor `createWebviewPanel`, which is the structural reason that module and the preview base, DDS view provider, extension entry point and context carried no coverage at all. The stub now provides minimal fakes for `createWebviewPanel` (a webview with `html`, `options`, `cspSource`, `asWebviewUri`, `postMessage` and the event and lifecycle members), `registerWebviewPanelSerializer`, `registerCustomEditorProvider` and `registerTextDocumentContentProvider`, plus the `openTextDocument`, `visibleTextEditors`, `onDidChangeActiveTextEditor` and `executeCommand` members those pull in, all wired into the existing capture-and-restore guarantee. The second import blocker was webpack's raw-loader imports -- `worldmap.ts` pulls `worldmapview.html` in as a string -- which the require hook now resolves to an inert empty module under plain `tsc` and Node. A new `previewmanager.test.ts` covers serializer installation and teardown through the aggregate disposable, and the three panel-deserialization disposal paths. No production code changed. Issue #56.

v1.1.19

  Functionality:

- [ Focus Tree ] Layout warnings are now readable off the tree itself instead of only out of a text panel. Every focus a warning names -- both ends of a mutually exclusive or overlap pair, every member of a same-position stack, and the focus a prerequisite or relative-position warning is filed under -- is drawn with a red box and a warning badge over its slot, the same treatment overlapping traits already get in the MIO preview. Where several warned focuses resolve to one slot, the badge carries the count, which is the only way to see that a focus is hidden underneath another one; the count is taken over warned focuses only, so shared and joint focuses merged in from another file, which the validator deliberately ignores, cannot produce a marker. Hovering a marked focus lists the warnings that concern it in the tooltip, after the focus id and position it already showed. The markers are drawn inside the focus element rather than over it, so they follow zoom, pan and branch visibility, do not survive a focus being filtered out, and are not erased by the search box writing its own outline and background onto every focus. They are `pointer-events: none`, so a click still reaches the focus underneath and jumps to its definition.
- [ Focus Tree ] The warnings panel is now a list of clickable entries rather than a read-only text box. Activating an entry -- by click, Enter or Space -- closes the panel, scrolls the offending focus to the centre of the canvas and flashes it, so a warning no longer has to be read as coordinates and then hunted for by hand. The wording of each entry is unchanged.
- [ Focus Tree ] New toolbar button next to the warnings button hides and shows the on-canvas markers, for when a marker covers an icon that needs looking at. It appears under exactly the same condition as the warnings button, defaults to on, and is remembered across reloads. Toggling flips the existing markers rather than re-rendering the tree, so it stays instant on large trees.

  Bugfixes:

- [ Focus Tree ] The red outline v1.1.18 announced for warned focuses never actually drew. It was registered in the per-render style table *after* that table had already been serialized into the document, and `StyleTable` snapshots its rules at serialization time, so the class landed on the focus element while no rule for it ever reached the page. The warning styles now live in the shell stylesheet, which is emitted once before any render, and the class names are shared between the content builder and the webview through a single module -- so the ordering that caused this cannot recur, and a test now asserts the markers really appear on the rendered nodes.

v1.1.18

  Functionality:

- [ Focus Tree ] The preview now reports layout mistakes that make a tree render wrong in game. After parsing, every `focus_tree` block is checked for four conditions: a `prerequisite` group in which no option is positioned above the focus that depends on it (a focus on the same row counts as not above, since the game draws the arrow into the row itself); `mutually_exclusive` focuses that are not on the same X column, which the game expects because it draws the exclusivity marker horizontally between them; two or more focuses that resolve to exactly the same position, reported as a single warning naming every focus in the stack; and focuses on the same row less than two columns apart, whose icons overlap because a focus sprite spans two grid columns. Positions are resolved through the whole `relative_position_id` chain, with circular chains cut off (those remain the domain of the existing relative-position warning) and condition-dependent `offset` blocks not applied, so a tree that relies on offsets is judged on its base coordinates. Only focuses defined in the previewed file are considered, so shared focuses merged into a tree from another file, and standalone `shared_focus` and `joint_focus` blocks -- which carry no meaningful coordinates of their own and would otherwise all appear stacked at the origin -- cannot raise a warning. Issue #61.
- [ Focus Tree ] Every focus named by a warning is now outlined in red on the preview canvas, alongside the existing warnings text panel. The outline covers both ends of a pair and every member of a same-position stack, not just the focus the warning is filed under, so an overlap or exclusivity problem can be located without reading coordinates out of the message. Highlights are re-applied on every re-render, including tree switches and condition changes, and the toolbar's warnings toggle now appears as soon as a tree gains its first warning instead of only when the preview was first opened with warnings present.

  Bugfixes:

- [ Focus Tree ] Explicit `OR = { ... }` blocks inside `prerequisite` and `mutually_exclusive` were silently discarded. The schema declared the key in upper case while file keys are matched lower-cased, so it never matched anything, and it was declared as a list of strings, which cannot represent a block in the first place. A focus written as `prerequisite = { OR = { focus_a focus_b } }` therefore parsed as having no prerequisites at all: the preview drew no prerequisite arrows into it, `mutually_exclusive = { OR = { ... } }` drew no exclusivity markers, and the completion propagation behind the focus checkboxes treated the focus as unconditionally reachable. Both spellings the game accepts are now read -- bare ids (`OR = { focus_a focus_b }`) and `focus = ...` entries (`OR = { focus = focus_a focus = focus_b }`) -- as well as the single-value form.
- [ Security ] Identifiers taken from mod files are now escaped before they are written into preview HTML. Focus ids, technology and sub-technology ids and MIO trait ids were interpolated unescaped into double-quoted `title`, `data-tech-id` and `data-subtech-id` attributes, so an id containing a quote character could terminate the attribute early and inject further attributes into the preview webview -- reachable simply by opening someone else's mod and running a preview. The escaping helper the GFX preview already carried privately was promoted to a shared `escapeAttr` in `src/util/html.ts` and is now used by the focus tree, technology and MIO content builders as well; unlike the existing `htmlEscape` it leaves spaces and newlines intact and only neutralises `&`, `"`, `<` and `>`, because the previews compare and filter on those ids client-side. Issue #58.
- [ Loading ] A failed index build no longer disappears without a trace. The GFX, localisation and shared-focus index builds, and their rebuilds after a workspace folder change, attached only a success handler to the build task, so a failure surfaced as an unhandled rejection inside the extension host: the progress notification vanished, the "index done" message never arrived, and the index stayed empty for the rest of the session with nothing written anywhere to explain it. All six sites now log the failure with a context naming which index failed, while the completion message and its telemetry still fire only on success.
- [ Loading ] A directory that cannot be listed is now logged instead of silently shortening the file list. Each of the three roots walked when listing mod and game files swallowed its errors completely, so an unreadable workspace, install or DLC folder produced a short listing -- files quietly missing from GFX, localisation and focus scans, and icons resolving to nothing -- with no indication of the cause. Listing still continues across the remaining roots and keeps everything gathered so far, but the failure is now reported with the exact path that could not be read.
- [ Loading ] Cache keys are validated rather than asserted. The file path, parse and file list caches re-parsed their JSON-encoded keys inside the cache factory and cast the result without checking its shape, so a malformed key threw from deep inside a cache factory or an expiry callback instead of producing a clean miss, and the file list cache parsed the same key twice on every lookup. Each key now goes through a validating parser: an unusable file path key resolves to nothing and an unusable list key to an empty list, both without issuing a single filesystem call; an unusable expiry key yields no expiry token instead of throwing during a cache sweep; and the parse cache raises an error naming the offending key. Reading a mod or game file as JSON now resolves the path explicitly and raises a "can't find file" error naming it, instead of failing indirectly.

  Cleanup:

- [ Build ] Enabled TypeScript's `noUncheckedIndexedAccess` and made the `curly`, `eqeqeq`, `no-throw-literal`, and `semi` ESLint rules errors. Indexed access across the extension and webviews now handles missing values explicitly, while `any` usage is reported as a warning.
- [ Testing ] Added a coverage gate, an integration smoke suite and unit coverage for the previews, the GUI widgets and the world map loaders. `c8` now enforces a minimum of 55% lines and 60% branches over the compiled extension sources through the new `test:coverage` script, and CI builds the test output, runs the coverage gate in place of the plain test run and uploads `coverage/lcov.info` as a build artifact. A second CI job launches a real VS Code host through `@vscode/test-electron` under `xvfb-run` (`test:integration`, excluded from the normal unit run) and asserts that the extension is present, that it activates with its four commands registered, and that the DDS and TGA custom editors are contributed. New unit suites cover the focus tree, GUI and technology content builders, the `hoi4gui` widgets (container window, grid box, button, icon, instant textbox and node common) and the world map loaders, including their malformed-input error paths. The periodic cache cleanup timer is now unreferenced where the runtime supports it, so the test run no longer needs mocha's `--exit` -- which had been force-killing the process and could mask unfinished asynchronous work. Both CI jobs moved from Node 20 to Node 24. Issues #54, #55, #57.

v1.1.17

  Functionality:

- [ Performance ] DDS and TGA decoding now spreads across a pool of worker threads instead of a single one. A focus tree queues hundreds of icon decodes at once and every one of them was serialized behind the same worker, so the conversion stayed effectively single-threaded no matter how many cores were available. The pool grows on demand: a single DDS view still spawns exactly one worker, and only a render that saturates the workers already running widens it, up to the configured cap. Each job goes to the least-busy worker and is tracked against it, so a decode error or a crash only affects the jobs that worker was holding.
- [ Settings ] New `mdHoi4Utilities.imageDecodeWorkers` setting (default 4, clamped to 1-16) caps how many decode workers may run at once. Higher values render icon-heavy previews faster at the cost of CPU and memory, since every worker is a full V8 isolate holding its own PNG buffers. Reloading is required after changing it.

  Bugfixes:

- [ Build ] Cleared all 18 advisories `npm audit` reports on the production dependency chain. The direct `js-yaml` dependency moved from the abandoned `3.x` line to `4.3.1` to pick up the fix for CVE-2026-59870 (quadratic CPU consumption in `!!omap` resolution, which `js-yaml` 3.x does not backport); `src/util/yaml.ts` was switched from `safeLoad` to `load(..., { schema: yaml.JSON_SCHEMA })` to preserve the safe-load semantics the 3.x `safeLoad` provided, and all six `util/yaml` unit tests continue to pass against the new line. `adm-zip` moved from `0.4.x` to `0.6.0` (the 0.6 line bundles its own TypeScript types, so `@types/adm-zip` is dropped), closing the crafted-archive 4 GB allocation issue. `copy-webpack-plugin` moved from `9.1.0` to `14.0.0` (it bundles its own types above `10.x`, so `@types/copy-webpack-plugin` is dropped) to clear the dev-chain RCE through `serialize-javascript`. The remaining three advisories `npm audit` still reports (`diff`, `mocha`, and a mocha-nested `serialize-javascript`) are reachable only through the test-runner chain, not from any production code path, and the only "fix" available is to downgrade mocha 11 to the 2021-era 8.1.3 line, which is rejected. Issue #45.
- [ Performance ] A decode that fails in a worker now falls back to the synchronous decoder instead of losing the image. `new Worker` reports a missing or unreadable entry file on the worker's `error` event rather than by throwing, so a build shipped without `imageWorker.js` produced a pool that looked healthy, accepted every queued job and then rejected all of them. Those images came back undefined and drew as blank icons, and the image cache held the failures for its full ten-minute life, so the preview stayed broken long after the render that caused it. The fallback already documented for "no worker could be spawned" now covers a failed job too.
- [ Performance ] The decode workers are terminated when the extension shuts down. Nothing released them before, so up to sixteen idle worker threads, each an isolate retaining its own heap, survived deactivation in a shared extension host until the window was reloaded.
- [ CI ] The release workflow now warns when it skips because the tag for the version in `package.json` already exists. Every step after the version check is conditional on it, so a merge that forgot the version bump produced a fully green run that built and published nothing.

v1.1.16

  Bugfixes:

- [ Settings ] DLC content is now looked for in `<install>/integrated_dlc` as well as `<install>/dlc`. Modern Hearts of Iron IV installs ship four DLCs -- Together for Victory, Death or Dishonor, Waking the Tiger and Man the Guns -- in that sibling folder, and both DLC scanners hardcoded the `dlc` segment, so roughly 1,900 sprite definitions and 1,700 image files belonging to those DLCs could never resolve and any preview referencing one of their sprites drew a blank icon, no matter how the install path was configured. The two scanners (zipped DLCs and loose DLC folders) now share one walk over both roots, keeping the existing `dlcNNN` folder-name filter and the zip-versus-loose split, which apply unchanged because the two layouts are identical. The base `dlc` folder is still scanned first, so resolution order for content that exists in both is unchanged, and an install that has no `integrated_dlc` folder (or neither folder) behaves exactly as before.
- [ Settings ] The `installPath` setting is now normalised the same way `modFile` already was: surrounding whitespace and a matched pair of single or double quotes are stripped before the path is turned into a URI. Windows Explorer's "Copy as path" puts the path on the clipboard wrapped in double quotes, and pasting that value left the quotes inside the path, so every `hoi4installpath:` lookup missed and no vanilla GFX, localisation or script resolved at all -- while mod-local files and the `modFile` setting kept working, which made the cause very hard to spot. The empty-value check now also catches a whitespace-only or `""` setting instead of treating it as a configured path.
- [ Settings ] Install path resolution was moved into a single shared module used by both readers. The DLC zip loader read the raw setting a second time and built its path with `path.join` directly, bypassing the resolver's cache and its not-set check, so a quoted or unset install path surfaced there as an opaque `adm-zip` failure; it now goes through the same resolved URI as every other install-path lookup.
- [ Settings ] A wrong install path no longer fails silently. On activation and whenever the setting changes, the resolved path is checked and an error message naming it is shown if it is not an existing directory (mirroring the existing report for a missing mod descriptor). A path that is simply not set yet stays silent, since that is the normal first-run state. The "install path is not set" error is also localisable now instead of being hardcoded English.

v1.1.15

  Functionality:

- [ MIO ] The trait preview gained a "Show overlapping traits" toggle, on by default. Two traits that resolve to the same grid slot are drawn on top of each other, so all but the last one rendered are invisible and the tree silently appears to lose a trait; every slot holding more than one trait is now marked with a red box carrying the collision count. Collisions are detected on the rendered grid items rather than on the raw trait list, so traits hidden by a branch condition, by `remove_trait` or by the inherited-traits toggle cannot raise a false positive. The markers are anchored like the grid guide (following zoom and pan) and do not intercept clicks, so the trait underneath stays clickable to jump to its definition, and the toggle state persists across in-place preview updates.

v1.1.14

  Functionality:

- [ MIO ] The "Show ingame ui" preview toggle has been replaced with a "Show grid" toggle. Instead of overlaying the in-game industrial-organization window chrome behind the trait tree, the preview now draws a column grid anchored to the same origin as the traits and headers: a faint vertical line at every column boundary (x = 0 through the limit), with the right edge of column 9 emphasized and labelled "x = 9 limit". The in-game MIO tree window only renders columns 0-9, so any trait positioned past x = 9 bugs out; the guide makes that width limit visible while laying out a tree. The overlay scales with zoom, tracks the grid when it shifts for negative-x traits, and its on/off state persists across in-place preview updates.

  Bugfixes:

- [ MIO ] Removed the in-game frame chrome rendering (the loader no longer parses `industrial_organization_detail.gui`, and the frame overlay, its availability probe and the associated localisation strings were dropped) now that the "Show grid" guide replaces it.

v1.1.13

  Functionality:

- [ Performance ] Paradox-script parse trees are now cached by file path and modification time. The parser previously re-tokenized the same unchanged files on every access; a shared cache (keyed the same way as the existing file-content and stat caches) now returns the parsed node tree directly, with a separate entry for the variable-resolved form so the one mutating consumer can never corrupt a shared tree. Files open with unsaved edits bypass the cache so live typing is always reflected. The focus-tree titlebar styles and the focus inlay/GUI/GFX resolution were switched over to it.
- [ Performance ] File path resolution across the workspace, mod and HOI4 install is memoized for 500ms. Resolving a single relative path used to run several `fs.stat` calls, and a focus render resolves hundreds of icons plus their expiry tokens, so this collapses hundreds of multi-stat resolutions per render into far fewer. The memo is cleared whenever the install path, mod file or workspace folders change (the same hook that clears the DLC and file caches), and open documents are still detected within the accepted 500ms staleness window.
- [ Performance ] Opened DLC `.zip` archives now keep only a lightweight per-zip index resident, not the whole archive. The cache that held them was capped at eight entries while a single file or directory lookup loops over every DLC (~30-40 on a current install), so the cap evicted archives mid-loop and each miss re-parsed a whole zip's central directory plus an extra stat. The cap was raised past the DLC count and the retention window lengthened, and every archive now builds a name→isDirectory and directory→contents index once on open (replacing the linear entry scan that ran on every lookup) while dropping the zip buffer, so the larger cache stays cheap in memory. A DLC file read reopens the archive transiently to pull just that entry, and repeated reads are served from the file-content cache.
- [ Performance ] The parser tokenizer no longer rebuilds its regular expression and token tables on every parse (they are invariant and now computed once at module load), and the per-line offset table used only in error messages is computed lazily on the first error instead of eagerly on every successful parse. Both costs multiplied across the thousands of files a full index build parses.
- [ Performance ] The shared focus index (and the optional GFX and localisation indexes) build with bounded parse concurrency instead of firing an unbounded `Promise.all` over every stale file at once. A cold activation no longer spikes memory holding every file buffer and parse tree simultaneously or stalls the extension host with one long synchronous parse burst; warm starts, which only re-parse changed files, are unaffected.
- [ Focus Tree ] Focus trees that reference no inlay windows (the common case) skip the inlay resolution entirely on each edit: parsing every file under `common/focus_inlay_windows` and the associated interface-tree scan are no longer run when there is nothing to resolve, and for trees that do use inlays the inlay/GUI/GFX parses are served from the shared parse cache. The set of GFX files tracked as dependencies is preserved exactly, so focus-icon resolution (which scans that set when the GFX index is off) is unchanged.
- [ Focus Tree ] Each debounced edit now short-circuits on a cheap fingerprint of the parsed tree objects before building any focus HTML. Previously the structure-only pass still rendered every focus to an HTML string just to fingerprint and skip; now a keystroke that changes nothing in the tree structure (ids, positions, prerequisites, icon names, source offsets) skips the whole render, and only a real change falls through to the existing structure/icon fingerprint path. The early-out is disabled while the localisation index is enabled, where resolved display text can change without any structural change.
- [ Technology ] Edits update the open technology preview in place instead of reloading the whole webview, matching the MIO preview. The extension posts the changed tree markup and styles to the running page, which swaps its content in place while preserving scroll position, zoom, the selected folder and the selected name mode, and refreshes the folder dropdown's entries without rebinding it. When the current page cannot accept updates (an error or "no technology tree" page) the next valid render falls back to a full reload, so the preview always recovers.
- [ Event ] The event tree preview gained the same in-place update. The changed grid markup and styles are posted to the running page and swapped in without a reload, preserving scroll and zoom; the event-picture hover handlers are rebound to the new nodes after each swap.
- [ GFX ] The GFX preview no longer reloads its webview when an edit does not change the rendered output. It hashes the rendered content (ignoring the per-render CSP nonces) and skips the reassignment on a match, removing the blank flash and the full re-decode of every inline sprite for no-op edits.
- [ Performance ] The DDS and TGA image viewers decode on a worker thread instead of the extension host, reusing the worker already used for focus-tree icons, with the synchronous path kept as an automatic fallback. Opening a large `.dds` or `.tga` no longer stalls the editor while it decodes and PNG-encodes. Sprite PNG dimensions are also read straight from the file header instead of fully decoding the image just to obtain its width and height.
- [ World Map ] Opening the map no longer re-renders the entire map once per data chunk. During the chunked load the webview previously allocated a fresh map wrapper per 300-item chunk, which defeated the render guard and forced a full offscreen redraw and reverse-map rebuild every chunk (O(chunks x provinces)); chunk emissions are now coalesced through `requestAnimationFrame` with a guaranteed final render, and the per-province reverse lookups the tooltip and renderer use (province to state, strategic region, supply area, railway level and supply node) are built once per map and reused instead of scanning every list on every hover frame. Hover rendering is likewise coalesced through `requestAnimationFrame`.
- [ World Map ] Railways and supply nodes are no longer transferred twice. The initial map summary shipped both arrays in full and the webview then re-requested them in chunks; the summary now omits them so they arrive only through the chunked path, and the chunk sizes were increased to cut the number of request/response round-trips.
- [ World Map ] The province-bitmap validation pass no longer allocates a four-element array and invokes a closure for every pixel of the (~11-million-pixel) province map, reading the four neighbouring province colours as local variables and only building the warning object on an actual invalid crossing. The reported invalid-X-crossing warnings are identical (guarded by new tests).

  Bugfixes:

- [ MIO ] An in-place update could strand the preview shell unstyled. The dragger, content wrapper and ingame-ui frame keep their DOM class names across updates while the update replaces the whole style sheet; those classes carried per-render counters that shifted whenever a tree header was added or removed, so the replaced sheet had no rules for them anymore. The shell now uses stable class names and renders before the per-trait and per-header styles. The new event and technology in-place updates use the same stable shell classes.
- [ Focus Tree ] Inlay-window slot geometry classes are now part of the icon fingerprint, so adding a scripted-image slot that reuses an already-resolved sprite triggers the CSS repush that carries the new slot's position rules. Previously the fresh slot markup could arrive with a class the webview had no rule for, leaving that slot unpositioned until a full reload.

v1.1.12

  Functionality:

- [ Technology ] Special-project technologies now render with the special-project background (issue #3). The schema parses each tech's `categories`, and a tech counts as a special project when its id starts with `SP_` and it carries a `CAT_sp_*` category (requiring both avoids tinting ordinary upgrade techs that only share the category). The previewer tries the `GFX_technology_<folder>_special_project[_small]_available_item_bg` sprites first and always applies a subtle inner-glow tint so SP techs stay distinguishable even when the SP sprite is missing. This covers sub-technologies too, which also fixes a latent bug where the sub-technology background lookup interpolated `[object Object]` instead of the folder name.
- [ MIO ] The previewer now shows `tree_header_text` column headers (issue #16). Each header renders above the trait grid at its declared `x` column, localised through the localisation index with the raw key as fallback, and tracks the selected organisation.
- [ MIO ] Edits now update the open preview in place instead of reloading the whole webview. The extension posts the changed data and styles to the running page, which preserves scroll position, zoom and the selected organisation while typing. The organisation dropdown refreshes its entries in place (and appears or hides when the file goes from one organisation to several or back). When the current page cannot accept updates (an error or "no MIO" page), the next valid render falls back to a full reload, so the preview always recovers.
- [ Previewer ] The event, GUI, technology and MIO previews no longer reload their webview when an edit does not change the rendered output. The four near-identical preview classes were collapsed into one shared `LoaderPreview` base that hashes the rendered content (ignoring the per-render CSP nonces) and skips the update entirely on a match, removing the blank flash and lost scroll position for no-op edits.
- [ Performance ] DDS and TGA icon decoding runs on a worker thread on desktop instead of blocking the extension host, with the previous synchronous path kept as an automatic fallback (web extension, worker failure). Icon-heavy focus trees no longer stall the editor while their textures convert.
- [ Performance ] Province map loading replaces two quadratic edge-joining scans with map lookups, keeping identical output (guarded by new characterization tests). File modification checks made during a render burst are memoized for 500ms, collapsing hundreds of stat calls per preview into one per file; open documents with unsaved edits always bypass the memo.

  Bugfixes:

- [ Focus Tree ] Fixed icons disappearing when the preview tab was hidden and shown again (issue #36). The resolved icon CSS only ever lived in the running webview, so VS Code's reload of a hidden panel restored the placeholder page and nothing re-sent the icons. The extension now caches the last pushed icon CSS and re-sends it whenever the webview signals it is ready or becomes visible, guarded by a generation token so a stale push can never overwrite newer icons.
- [ Focus Tree ] The preview no longer rebuilds all GFX on every edit (issue #37). Each debounced change now renders a cheap structure-only pass and compares two fingerprints: one over the rendered structure, one over the icon identities (names and sources, not pixel data). Unchanged edits post nothing at all, structural changes patch the tree in place, and the expensive icon resolution only runs when an icon is actually added, removed or changed.
- [ Focus Tree ] Seven untranslated toolbar and label strings ("Custom titlebars", "Inlay windows", "<Joint focus tree>" and friends) received real localisation keys, and the ko/ru/zh-cn locale tables were regenerated from the English source (they had drifted and were missing earlier keys too).

  Cleanup:

- [ Build ] The minimum VS Code version is now 1.74 (November 2022). The five `onCommand` activation events that VS Code generates automatically since 1.74 were removed, `@types/vscode` and `@types/node` were brought up to date, and the dead `test-ui` scripts plus their orphaned `@vscode/test-electron` dependency are gone. Telemetry is disabled: the reporter (which only ever had a placeholder key) is no longer constructed and `@vscode/extension-telemetry` was dropped.
- [ Tooling ] ESLint now actually type-checks: the `@typescript-eslint` plugin was added with `no-unused-vars`, `no-duplicate-imports` and typed `no-floating-promises`, and every surfaced violation was fixed (including two progress callbacks that were genuinely missing their `await`). The test tsconfigs were aligned to es2022 and the TS deprecation suppression removed; `noUnusedLocals` is on and the dead code it found was deleted.
- [ Cleanup ] Removed dead code and duplication across the extension: the unused `clearFileListCache` and `scaleCopy` functions, a broken development-only command that required a nonexistent module, two unrunnable helper scripts, an eight-times-duplicated webview script literal (now one helper), the world map's copy of the open-or-copy-file logic (now shared with the previews), and a long-standing `previewContructor` typo. The output channel no longer steals focus on activation, the README documents the correct `mdHoi4Utilities.*` settings prefix, and stale `.vscodeignore` entries were pruned.

v1.1.11

  Bugfixes:

- [ Build ] Fixed the automated Release workflow failing on the *Publish to VS Code Marketplace*

v1.1.10

  Functionality:

- [ World Map ] The state hover tooltip now lists a state's `impassable_ignored_links`. HOI4 1.19.1 added this field to impassable states to name the neighbouring state IDs that are ignored when evaluating the impassable state's ownership and control. The world map loader previously parsed `impassable` but discarded the link list; it is now read as a numeric ID list and shown directly under the red **Impassable** line as `Impassable ignored links=...`. The extra line only appears for impassable states that actually define the field; passable states and impassable states without it are unaffected.
- [ Focus Tree ] Added a topbar button to reset all focus-completion checkboxes. The checkboxes that appear on focuses referenced by an `allow_branch` condition let you preview a tree as if that focus were completed, but if your `allow_branch` logic hides the very focus that owns a ticked checkbox there was no way to untick it again, leaving the preview stuck. The new button clears every checkbox at once (resetting the persisted `checkedFocuses` state and rebuilding the tree, so hidden branches reappear). It is only shown when the file actually uses `allow_branch`, and it does not touch the allow-branch dropdown's manual show/hide selections.

  Bugfixes:

- [ Focus Tree ] The focus tree preview now understands the new dynamic focus icon syntax introduced in HOI4 1.19. Previously only the old `icon = { trigger = { ... } value = GFX_focus_x }` form was parsed; the new form puts every alternate icon in a single block as `GFX_focus_x = { <triggers> }` for conditional icons and `GFX_focus_x = yes` for the default. Focuses using the new syntax produced no icon name at all, so the preview drew a grey box with no icon. The parser now reads both forms (and the plain `icon = GFX_focus_x` string form), supports more than two alternate icons per focus, and preserves source order so the first matching condition wins on the client, with the `= yes` default applied last.
- [ Focus Tree ] Fixed a grey square showing behind focus icons that did load correctly. The two-phase render registers a translucent grey placeholder (`background-color`) during the fast structural pass and then streams the resolved icon (`background-image`) into a separate style element; because those are different CSS properties they stacked, so the placeholder colour kept showing through the transparent parts of the icon. The resolved-icon rule now also sets `background-color: transparent`, clearing the placeholder once the real icon is in place. The grey fallback for genuinely missing or unresolvable icons is unchanged.
- [ Localisation ] Fixed localisation files failing to parse — and a misleading `parsing failed! ... can not read a block mapping entry; a multiline key may not be an implicit key` error logged against an unrelated key — after a window reload. The index built each `.yml` by preprocessing it with a regex and then loading the result through js-yaml. A source line the regex could not match (most commonly a value missing its closing quote, e.g. EaW's `EYE_ALV_fascism_ADJ:0 "Великозёрск`, but also values containing embedded quotes) was emitted into the YAML stream unchanged, where js-yaml treated it as a multi-line scalar that swallowed every following line until it hit the next clean `KEY:` and reported the error there. One malformed entry therefore discarded every entry after it in the same file and blamed an innocent line. Localisation is now parsed line by line instead of round-tripping through js-yaml: each entry is independent, so a malformed line is skipped on its own and all other keys still index, embedded quotes in a value are preserved, and the spurious error no longer appears. (The errors surfaced only after a reload because that is when the full workspace scan re-parses every localisation file, whereas a normal editing session only re-parses files you touch.)
- [ Technology ] Fixed technologies that showed only their raw id in the preview, and replaced the two-state "Show localisation" checkbox with a four-way "Name" dropdown (Id / Short name / Long name / Technology name). Name resolution previously tried the technology's own localisation key and then only the bare equipment id, so techs whose tree name comes from an equipment short name (the form HOI4 actually displays) fell through to the raw id. The previewer now parses `common/units/equipment/*.txt` to read each archetype's `short_name` localisation key (following the `archetype` parent when an equipment declares none) and also honours the `<equipment>_short` naming convention. Each technology renders all four name variants and the dropdown picks which is shown, with per-mode fallback (short→long→tech name→id, long→short→tech name→id, tech name→id); the choice persists across folder switches and reloads. The equipment files are tracked as preview dependencies, so editing a `short_name` refreshes the tree, and the parse is skipped entirely when the localisation index setting is off (everything falls back to ids, with the existing ⚠ warning shown for any non-id mode). The default mode remains Id, so the preview is unchanged until a name mode is chosen.

v1.1.9

  Functionality:

- [ Focus Tree ] The focus tree preview now renders in two phases so a heavy tree appears almost immediately instead of hitting the render timeout. The first phase draws every focus box, its title, position, prerequisites and branches with a neutral placeholder where the icon goes; this pass does no image decoding and is fast even for trees whose icons are slow or unresolvable. The expensive part — one synchronous DDS->PNG conversion per distinct focus icon — then runs in the background and its CSS is streamed into the already-visible preview through a new `iconStyles` message, filling the placeholders in once ready. The 60-second render budget now only guards the cheap structural pass, so slow icon conversion no longer blocks the tree or fails the whole preview; the webview signals readiness before the icon CSS is sent so the update is never dropped.

  Bugfixes:

- [ Focus Tree ] With the GFX index enabled, a focus icon that is not in the index no longer triggers a scan over the whole gfx dependency list (which could repeatedly re-parse large `.gfx` files such as `interface/goals.gfx`): the index is authoritative, so an unindexed sprite returns the grey fallback immediately. When the index is disabled the fallback scan still runs, but an unresolved icon name is now memoised per render so it is searched once instead of for every focus that references it.

v1.1.8

  Functionality:

- [ Previewer ] The animated loading spinner that the focus tree preview showed while building is now a shared, standard part of every preview. While a technology tree, MIO, event, GUI or GFX preview is being built, the panel shows the same centered spinner with a status line instead of the previous plain "Loading..." text. The DDS and TGA image viewers also show it while a (potentially large) texture is read and decoded, replacing it with the rendered image once decoding finishes. The shell still listens for progress updates, so previewers that report progress (the focus tree) keep showing their live message and counter. The spinner markup lives in a single `loadingShellHtml` helper reused by `PreviewBase` and the image viewers, removing the duplicated copy that previously only existed in the focus tree preview.

  Bugfixes:

- [ Build ] Fixed the packaged extension failing to activate in production with `ReferenceError: TelemetryReporter is not defined`, which left every preview command unregistered ("command 'mdhoi4utilities.preview' not found") and the output channel empty. The real `import TelemetryReporter from '@vscode/extension-telemetry'` had been replaced by a `declare const` global that nothing supplied: `EXTENSION_ID`/`VERSION` survived because the webpack DefinePlugin inlines them as string literals, but the reporter class did not, so the production bundle referenced an undefined global. Development builds were unaffected because they use the in-process `DevTelemetryReporter`. Restoring the import lets webpack bundle the class again.

v1.1.7

  Functionality:

- [ Technology ] Added an in-preview "Show technology id" checkbox to the technology tree toolbar, next to the folder selector. It toggles every tech label live between its localised name and its raw id (e.g. `infantry_weapons1`) without reloading the preview, and without shifting the tech icons or positions. The existing "Technology: show raw id instead of localisation" setting now seeds the checkbox's initial state, and the choice is remembered across folder switches and reloads.

  Bugfixes:

- [ Build ] Fixed the development build (`webpack-dev`) failing to compile after the TypeScript 6 upgrade. The world map top bar now types the `vscode` webview API instead of treating it as `any`, and `toBehaviorSubject` is generic over its value type, so the stricter compiler accepts the existing code without behaviour changes.

v1.1.6

  Functionality:

- [ Testing ] Extended the unit test suite to cover the dependency resolver, HTML helpers, style table, schema matcher, sprite type loader and the cache, on top of the existing cache and parser tests. A stubbed `vscode` module lets these pure-function tests load source files that `import * as vscode from 'vscode'` without the extension host.
- [ CI ] Added GitHub Actions workflows: a CI workflow that runs lint and tests on push and pull request, and a release workflow that packages the VSIX and publishes to the Open VSX Registry on a `v*` tag (or manual dispatch). Both pin actions to commit SHAs, and the release workflow verifies the tag matches the package.json version.

  Bugfixes:

- [ HTML ] `htmlEscape` encoded newlines as `&#13;` (carriage return) instead of `&#10;` (line feed). Screen readers and text extraction tools treat the two differently, so newlines are now encoded correctly.
- [ CI ] On a manual (`workflow_dispatch`) release the GitHub Release was named after the branch instead of the version; it now uses the tag or the dispatched input. The VSIX lookup step now fails with a clear error when no `.vsix` was produced instead of passing an empty path downstream, and an unused `VSCE_TOKEN` env var was removed.
- [ Testing ] The `vscode` test stub's `Uri.joinPath` dropped every path segment after the base, returning the base path unchanged; it now joins the segments like the real API. Debounce tests use a larger timing margin so they stay reliable under heavy CI load.

v1.1.5

  Functionality:

- [ MIO ] The ingame UI preview now shows the whole organisation window. You get the left panel (icon, size, points, aggregated bonuses and the policy slot) and the traits/history tabs around the trait tree, instead of just the tree on its own.
- [ Performance ] Previews open faster and use less memory. The same files are no longer read and parsed again and again while a single preview loads. Files you have open in the editor, including unsaved edits, are still read live, so previews always reflect your latest changes.
- [ Performance ] The world map now frees its memory when you switch to another tab and rebuilds it when you come back. New setting "World map: keep webview in memory when hidden" lets you keep it loaded for instant tab switching if you have memory to spare.
- [ Performance ] Image and file caches now have a size limit, so previewing a lot of art no longer keeps piling up memory until a timer clears it. When the limit is hit, the genuinely least recently used entries are dropped first.
- [ Performance ] Building the gfx and focus search index is lighter on memory, and the localisation reader is only loaded when you actually use it.
- [ Technology ] New setting "Technology: show raw id instead of localisation". When on, the technology tree shows each tech's raw id instead of its localised name. It applies to every tech, both those with their own localisation and those that fall back to the name of the equipment they unlock, so you can read the ids straight off the tree while modding. Off by default; localisation is still shown otherwise.
- [ Testing ] Added a unit test suite (cache and HOI4 parser) that runs with "npm test" through a dedicated tsconfig.test.json, so the core logic can be checked without the full webpack build.

  Bugfixes:

- [ Focus Tree ] Focus inlay windows render again. The tool now looks for the scripted GUI window and its art anywhere under interface/, not only interface/scripted_gui (which vanilla does not use), so windows like Germany's inner circle show up.
- [ GUI ] Scripted GUI files that showed nothing now display. Windows that set their size or position with @variables were shrinking to nothing because those values were not read; they are now.
- [ Technology ] A technology with no name of its own now shows the name of the first equipment it unlocks, the same as in game, instead of the raw key.
- [ Technology ] Fixed: the tech tree webview was missing navigator click-to-source, drag-to-scroll, and scroll-position restore because `initCommon()` was imported but never called.
- [ Localisation ] Fixed a regex bug in the localisation file preprocessor that treated `#` characters inside quoted strings as YAML comments. This caused cascading parse failures in files like `country_HLR_l_english.yml`, `country_HYE_l_english.yml`, and others where mod text legitimately contained `#`.
- [ Telemetry ] Fixed: the telemetry source file was accidentally minified to a single line, making it unreadable in version control and removing typed property/measurement signatures.

v1.1.3

  Functionality:

- [ Focus Tree ] Large focus trees now render through a limited concurrency pool, keeping progress updates responsive instead of freezing under memory pressure
- [ Focus Tree ] Added a "still working" indicator and a Reload button so a slow or failed render no longer leaves the preview stuck on a loading spinner
- [ Focus Tree ] Added a render timeout that surfaces a recoverable error panel rather than hanging indefinitely

  Bugfixes:

- [ Focus Tree ] Fixed focuses and inlay windows being rendered twice on the initial preview load

v1.1

  Functionality:

- Changed icon to match compatibility with CWTools
- [ Focus Tree ] Topbar has been made bigger
- [ Focus Tree ] Textbox and overlay checkboxes only apear if found in the file
- [ MIO ] previewer will show included traits
- [ MIO ] previewer also shows the ingame UI

  Bugfixes:

- [ Technology ] Fixed duplicate icon in previewer

v1.0

Functionality:

- Joint Focus trees can now be previed from their file or the linked national focus
- Custom Titlebars can now be shown in the focus tree preview (togglable)
- Custom Focus Overlays can now be shown in the focus tree preview (togglable)
- Focus Inlay Windows can now be shown in the focus tree preview (togglable)
- Changed feature settings to boolean instead of free text
- Add a setting to link technology interface files so the preview can look up other folders for technology icons

Bugfixes:

- Fixed error when copy paste the .mod file location. Now with "" the file will be located.
