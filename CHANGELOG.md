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