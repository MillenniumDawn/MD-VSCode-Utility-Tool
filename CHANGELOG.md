v1.1.7

  Bugfixes:
  - [ Build ] The webpack/extension build pulled the entire `src/test` tree into the TypeScript program, so the preview build flooded with hundreds of `TS2593: Cannot find name 'it'/'describe'/'beforeEach'` errors because the main tsconfig does not load the Mocha types. The test sources are now excluded from the extension build (they keep compiling through their own tsconfig.test.json / tsconfig.webview.test.json), so the preview compiles cleanly.


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