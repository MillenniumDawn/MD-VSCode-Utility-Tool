v1.1.6

  Functionality:
  - [ Technology ] New setting "Technology: show raw id instead of localisation". When on, the technology tree shows each tech's raw id instead of its localised name. It applies to every tech, both those with their own localisation and those that fall back to the name of the equipment they unlock, so you can read the ids straight off the tree while modding. Off by default; localisation is still shown otherwise.


v1.1.5

  Functionality:
  - [ MIO ] The ingame UI preview now shows the whole organisation window. You get the left panel (icon, size, points, aggregated bonuses and the policy slot) and the traits/history tabs around the trait tree, instead of just the tree on its own.
  - [ Performance ] Previews open faster and use less memory. The same files are no longer read and parsed again and again while a single preview loads. Files you have open in the editor, including unsaved edits, are still read live, so previews always reflect your latest changes.
  - [ Performance ] The world map now frees its memory when you switch to another tab and rebuilds it when you come back. New setting "World map: keep webview in memory when hidden" lets you keep it loaded for instant tab switching if you have memory to spare.
  - [ Performance ] Image and file caches now have a size limit, so previewing a lot of art no longer keeps piling up memory until a timer clears it. When the limit is hit, the genuinely least recently used entries are dropped first.
  - [ Performance ] Building the gfx and focus search index is lighter on memory, and the localisation reader is only loaded when you actually use it.
  - [ Testing ] Added a unit test suite (cache and HOI4 parser) that runs with "npm test" through a dedicated tsconfig.test.json, so the core logic can be checked without the full webpack build.

  Bugfixes:
  - [ Focus Tree ] Focus inlay windows render again. The tool now looks for the scripted GUI window and its art anywhere under interface/, not only interface/scripted_gui (which vanilla does not use), so windows like Germany's inner circle show up.
  - [ GUI ] Scripted GUI files that showed nothing now display. Windows that set their size or position with @variables were shrinking to nothing because those values were not read; they are now.
  - [ Technology ] A technology with no name of its own now shows the name of the first equipment it unlocks, the same as in game, instead of the raw key.


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