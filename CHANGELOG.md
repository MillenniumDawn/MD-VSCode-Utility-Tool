v1.1.10

  Functionality:
  - [ Focus Tree ] Added a topbar button to reset all focus-completion checkboxes. The checkboxes that appear on focuses referenced by an `allow_branch` condition let you preview a tree as if that focus were completed, but if your `allow_branch` logic hides the very focus that owns a ticked checkbox there was no way to untick it again, leaving the preview stuck. The new button clears every checkbox at once (resetting the persisted `checkedFocuses` state and rebuilding the tree, so hidden branches reappear). It is only shown when the file actually uses `allow_branch`, and it does not touch the allow-branch dropdown's manual show/hide selections.

  Bugfixes:
  - [ Focus Tree ] The focus tree preview now understands the new dynamic focus icon syntax introduced in HOI4 1.19. Previously only the old `icon = { trigger = { ... } value = GFX_focus_x }` form was parsed; the new form puts every alternate icon in a single block as `GFX_focus_x = { <triggers> }` for conditional icons and `GFX_focus_x = yes` for the default. Focuses using the new syntax produced no icon name at all, so the preview drew a grey box with no icon. The parser now reads both forms (and the plain `icon = GFX_focus_x` string form), supports more than two alternate icons per focus, and preserves source order so the first matching condition wins on the client, with the `= yes` default applied last.
  - [ Focus Tree ] Fixed a grey square showing behind focus icons that did load correctly. The two-phase render registers a translucent grey placeholder (`background-color`) during the fast structural pass and then streams the resolved icon (`background-image`) into a separate style element; because those are different CSS properties they stacked, so the placeholder colour kept showing through the transparent parts of the icon. The resolved-icon rule now also sets `background-color: transparent`, clearing the placeholder once the real icon is in place. The grey fallback for genuinely missing or unresolvable icons is unchanged.

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