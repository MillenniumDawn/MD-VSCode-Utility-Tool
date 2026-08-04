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