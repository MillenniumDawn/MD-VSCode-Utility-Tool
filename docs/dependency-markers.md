# Dependency markers

Some HOI4 files refer to other files that a preview cannot infer from the game syntax alone. Put a marker at the start of a line in the file being previewed to tell that preview to load an additional file:

```text
#!event:events/example_events.txt
#!localisation:localisation/english/example_l_english.yml
```

The form is `#!type:path`, with the path relative to the mod or game data root, using paths such as `events/example_events.txt` or `interface/example.gui`. Use `/` between folders. The parser also normalizes repeated `/` and Windows `\` separators to `/`. Put one marker on each line. Leading whitespace is allowed, and spaces or tabs at the end of the path are trimmed before its extension is checked. The first colon separates the type from the path, so a colon within the path is retained.

## What the parser accepts

The marker parser is permissive about the type name. It extracts a marker only when the trimmed path has an extension and either the extension is exactly the type, or the extension is `txt` or `yml`. Matching is case-sensitive: use lowercase `txt` and `yml`, and the exact lowercase type spelling used by the relevant preview. For example, `#!event:events/example.txt` and `#!sprite:gfx/example.sprite` pass parsing, as does `#!event:events/example.txt ` with a trailing space; `#!event:events/example.TXT` does not. The parser does not validate whether a type is meaningful to the current preview, whether the file exists, or whether its extension is appropriate for that type.

Each preview consumes only the marker types its loader understands. Current consumers include `event`, `gfx`, and `localisation` or `localization` for event previews; `decision` and `gfx` for decisions; `idea` and `gfx` for ideas; `focus` and `gfx` for focus trees; `gfx` and `gui` for technology and GUI previews; `gfx` for characters and balance of power; and `mio` and `gfx` for MIO previews. The spelling `localization` is accepted by the event loader alongside `localisation`; Scan References emits the latter. The event loader reads a `localisation` marker only when its path ends in `.yml`, so a `.txt` path passes parsing and is then ignored. An unknown marker can therefore be parsed without affecting a preview. Follow the marker type shown by the preview or Scan References rather than assuming every type is supported everywhere.

Markers add inputs to the preview. They do not replace the preview's automatic dependencies, which are discovered by its loader from the files and settings it uses. The marker path is loaded through the mod/game file lookup and, for every type a preview consumes except `gfx`, reported as a preview dependency, so an edit to a loaded dependency can refresh the preview. A `#!gfx:` marker is reported only by the focus tree, MIO, GUI, technology and balance of power previews. The event, idea, decision and character previews load the `.gfx` file but do not report it, so an edit to a file that only such a marker names does not refresh them.

## Scan References for event files

Open an event file, click into its text editor (not the preview panel), and run **Scan References** from the command palette. Both the command and its check that the file is an event file read the active text editor, so it works only while an event file's text editor is active. It scans event files under the mod/game `events` folder, follows event calls outward and backward to events that call the selected file's events, then finds localisation files in the selected preview language that contain titles or option-name keys from the reached events. It inserts new `#!event:` and `#!localisation:` lines at the top of the current file. Existing matching markers are skipped; it does not remove or rewrite existing markers.

The scan shows cancellable progress. If canceled, or if the document is closed before the final edit begins, it returns without a success message. Read/parse errors for individual candidate files are logged and skipped; an exception during the edit is reported as a scan failure. If the command says there is no open editor, open the target event file first. If it reports an unsupported type, the active text editor is not on an event file; click into the event file's text editor rather than the preview panel. The scan adds event and localisation inputs it can establish; other types of references, including graphics, remain the responsibility of automatic loader discovery or manually written markers understood by that preview.

## Refresh behavior and limits

An open preview subscribes to the dependency files it loaded. Editing a subscribed dependency schedules a refresh (debounced by one second), and changes to a dependency are passed to the renderer as dependency changes so it can reload data that is not visible in the preview file's own text. This tracking applies to dependencies actually reported by the preview loader; an unrecognized marker or a path the loader cannot load will not create a useful subscription.

Edits are noticed through the editor's change events. The file watcher the extension registers covers `**/*.txt` and ignores change events, so it only sees `.txt` files being created or deleted. An edit made outside VS Code, such as by another tool or a git checkout, is therefore not seen by an open preview. Make the edit in VS Code or reopen the preview.

Markers are single-file references. The parser does not expand wildcards, recurse through a folder, or interpret glob syntax. Use explicit paths, and confirm the target exists in the mod/game lookup. If a preview is missing referenced content, check the marker is on its own line (leading whitespace is allowed), uses a lowercase supported extension, uses the exact type spelling accepted by that preview, and points to a mod-relative path. Also check that the file type is one the preview's loader consumes.

## Source

- [Marker parsing and Scan References](../src/util/dependency.ts)
- [Dependency loading](../src/util/loader/loader.ts)
- [Event marker consumers](../src/previewdef/event/loader.ts)
- [Preview dependency refresh subscriptions](../src/previewdef/previewmanager.ts)
- [Parser and scan behavior checks](../src/test/dependency.test.ts)
- [Marker parsing checks](../src/test/unit/util/dependency.test.ts)
