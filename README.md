<p align="center"><img src="icon.png" width="160" alt="Millennium Dawn – HOI4 Utilities"></p>

# HOI4 Utilities 2026

**See your Hearts of Iron IV mod the way the game will draw it — without launching the game.**

Open a focus tree, an event file, a decisions file, an ideas file or the map folder, press the
preview button, and the extension renders it next to your code with the game's own icons and
textures. Edit the file and the preview follows. Click anything in the preview and the editor
jumps to where it is defined.

The extension includes a browser build and is smoke-tested in VS Code for the Web on CI: the
browser build activates and opens a focus tree preview. In a browser, files outside the workspace
are not assumed to be accessible. Base-game icons and localisation, the game launcher registry,
and other files from a local Hearts of Iron IV installation may therefore be unavailable; previews
use the files exposed by the VS Code workspace provider.
Install it from the [VS Code Marketplace][marketplace] or [Open VSX][openvsx].

Continuation of [hoi4modutilities](https://github.com/herbix/hoi4modutilities) by herbix,
maintained by the Millennium Dawn team. Very big shoutout to AngriestBird for helping this project!

## What you get

**Focus trees.** The tree as it appears in game: real focus icons, the game's own textures for
prerequisite and mutually exclusive links, shared and joint focus trees merged into the tree that
uses them, focus inlay windows and dynamic focus icons. The preview reports layout mistakes that
would render wrong in game — overlapping focuses, misplaced shared focuses, broken relative
positions — as a clickable list and as red markers on the tree itself. Shift+click a focus to
isolate its prerequisite lines, tick focuses off as completed to see which branches open up, and
search a tree by focus id.

**Event chains.** An events file becomes a graph of which event fires which, with every arrow
labelled by its condition, delay and `random_list` weight. `FROM` resolves to the event that
actually fired the call. Filter by event kind, show or hide hidden events, search by id or title,
and use **Scan References** to find every place in the mod that fires an event.

**Decisions.** Decision categories, decisions and missions drawn as a graph, with the localised
names from your mod.

**Ideas.** Every idea in a `common/ideas` file as a card, grouped by category, with its icon,
cost, traits, modifiers and `allowed` / `available` conditions. Ideas that swap into one another
are drawn as a chain; clicking an arrow opens the file that performs the swap.

**Characters.** Portraits, roles and, for every trait a character carries, the modifiers it
grants — advisor, army, navy and political roles side by side.

**Balance of power.** Every balance of power in a `common/bop` file as the game draws it: the
localised title, both side icons and the bar with each range as its own segment. A slider moves the
value so you can walk through the ranges and see the modifiers of the active one, and overlapping
ranges or gaps between them are flagged.

**Technology trees.** The full tree laid out from the mod's own `.gui` files. Optionally choose a
country and see the tree with that country's own technology icons, the way the game shows it.

**Military Industrial Organizations.** The MIO trait tree with a grid guide and a marker on every
slot where two traits overlap, so a trait cannot silently disappear behind another.

**World map.** Provinces, states, strategic regions and supply areas rendered from the map
folder, with railways and supply nodes, hover tooltips for every province and state, and a
warnings view that points at invalid province crossings and other map file mistakes.

**GUI files.** `.gui` windows rendered with their sprites.

**Sprites and images.** `.dds` and `.tga` files open as images straight in the editor, and a
`.gfx` file shows every sprite it defines.

**In every preview.** Scroll with the mouse wheel or the trackpad, or drag the canvas; zoom with
Ctrl+wheel, the zoom buttons or the +/- keys. Click an element to jump to its definition. Text comes from your
localisation files, in the language you choose. Vanilla and DLC content is read from your game
install, and the mod's `.mod` file is honoured for `replace_path`. A submod that only holds the
files it overrides gets the mods it extends from the `dependencies` list in its `.mod` file, each
name resolved to a folder through the launcher's mod registry; their files are read after the
workspace and before the game install, so shared sprites, layouts and localisation resolve without
copying them in. A mod the registry does not know goes in `mdHoi4Utilities.parentModPaths`, which
also wins over the registry for a mod listed in both. Each parent's own `descriptor.mod` counts
for `replace_path` too, as it does in the game.

## Get started

1. Install the extension.
2. Open the command palette (`Ctrl+Shift+P`) and run **Select HOI4 Install Path** to point the
   extension at your Hearts of Iron IV installation.
3. Open your mod folder. If it holds more than one `.mod` file, run **Select Mod File** to choose
   the one to work with.
4. Open a file and press the preview button in the editor's title bar, press
   `Ctrl+Shift+Alt+V`, or run **Preview HOI4 file** from the command palette. You can also
   right-click the file, in the editor or in the explorer, and choose **Preview HOI4 file**.
   **Preview World Map** opens the map.

## Settings

The Settings editor lists them under the extension in these sections.

**Game and mod**

| Setting | What it does |
|---|---|
| `mdHoi4Utilities.installPath` | Hearts of Iron IV install path. Without it most previews have no icons. |
| `mdHoi4Utilities.modFile` | The `.mod` file to read `replace_path` from. Defaults to the first `.mod` file in the workspace. |
| `mdHoi4Utilities.parentModPaths` | Absolute folders of the mods this workspace extends, in order, for what the `.mod` file's `dependencies` cannot resolve. Searched after the workspace folders and before the game install, e.g. `["D:/mods/parent-mod"]` in the submod's `.vscode/settings.json`. An entry here wins over the registry's folder for the same mod. |
| `mdHoi4Utilities.userDataPath` | The Hearts of Iron IV user data folder (the one with `dlc_load.json` and the launcher's `mod` folder), where `dependencies` names are looked up. Found automatically when empty, including a Documents folder Windows has moved. |
| `mdHoi4Utilities.loadDlcContents` | Load DLC images when previewing. Uses more memory. |

**Previews**

| Setting | What it does |
|---|---|
| `mdHoi4Utilities.previewLocalisation` | Language of the text shown in previews. |
| `mdHoi4Utilities.previewWheel` | What a plain mouse wheel does: `scroll` (default), `zoom`, or `auto` (zoom for a mouse, scroll for a trackpad). Ctrl+wheel, the zoom buttons and the +/- keys always zoom. |
| `mdHoi4Utilities.eventTreePreview`, `decisionPreview`, `ideaPreview`, `characterPreview`, `bopPreview` | Turn an individual preview on or off. |
| `mdHoi4Utilities.useConditionInFocus` | Show conditions in the focus tree preview. |
| `mdHoi4Utilities.inlayWindowGfxRoots` | Folders scanned first for the `.gfx` files that focus inlay windows use, before the whole `interface/` folder. Empty by default. An `inlay_window_gfx_roots = { "interface/scripted_gui" }` list in the mod's `.mod` file does the same. |
| `mdHoi4Utilities.focusOverlayGfxFiles` | The mod's `.gfx` files (or folders of them) that define focus overlays, searched after the game's `interface/goals.gfx`. A `focus_overlay_gfx = { "interface/goals_overlays.gfx" }` list in the mod's `.mod` file does the same. |
| `mdHoi4Utilities.decisionGfxFiles` | The mod's `.gfx` files (or folders of them) that define decision sprites, searched after the game's `interface/decisions.gfx`. A `decision_gfx = { "interface/MD_decisions.gfx" }` list in the mod's `.mod` file does the same. |
| `mdHoi4Utilities.ideaPlaceholderIcon` | The image drawn for an idea whose picture does not resolve, used when the mod's `.mod` file has no `idea_placeholder_icon = "gfx/interface/ideas/WIP_idea.dds"` line. Without either, the game's `gfx/interface/ideas/idea_PLACEHOLDER.dds` is drawn. |
| `mdHoi4Utilities.characterTraitStructuralKeys` | Keys the mod writes flat on its character traits that are not modifiers, so the character preview leaves them off the trait cards. The base game's own keys are always recognised. A `character_trait_structural_keys = { my_key }` list in the mod's `.mod` file does the same. |
| `mdHoi4Utilities.modifierFormatFiles` | Files (or folders of them) in the `common/modifier_definitions` syntax that set how the idea, decision and character previews show a modifier the game defines internally, for a mod that needs a different format than the built-in one. Only the fields an entry writes change. Keep them outside `common/modifier_definitions`, which the game loads. A `modifier_format_files = { "common/my_modifier_formats.txt" }` list in the mod's `.mod` file does the same. |
| `mdHoi4Utilities.technologyGfxRoots` | Folders scanned for `.gfx` files used by the technology tree, including country-specific icons. |
| `mdHoi4Utilities.technologyCountryIcons` | Add a country selector to the technology tree preview and prefer that country's icons. |

**World map**

| Setting | What it does |
|---|---|
| `mdHoi4Utilities.enableSupplyArea` | Show supply areas, for mods targeting HOI4 1.10 or older. |
| `mdHoi4Utilities.worldMapRetainContextWhenHidden` | Keep the world map loaded while its tab is hidden. Faster to switch back, more memory. |

**Indexes and performance**

| Setting | What it does |
|---|---|
| `mdHoi4Utilities.sharedFocusIndex` | Index shared focuses so other trees can pull them in. |
| `mdHoi4Utilities.ideaSwapIndex` | Scan `common` and `events` for `swap_ideas` so the idea preview can draw idea chains. |
| `mdHoi4Utilities.gfxIndex` | Index every sprite definition. Faster icon lookups, more memory. |
| `mdHoi4Utilities.localisationIndex` | Index localisation so previews show translated text. Uses more memory. |
| `mdHoi4Utilities.imageDecodeWorkers` | Threads used to decode `.dds` / `.tga` images. More is faster on icon-heavy trees. |

**Auditor**

The **Check all focus trees** link in this section (also **Check All Focus Trees** in the command
palette) checks every focus tree file for the problems the focus tree preview warns about, and
lists them per file in one Markdown report you can paste into a GitHub issue.

| Setting | What it does |
|---|---|
| `mdHoi4Utilities.auditor.reportFolder` | Folder the report is saved to, as `focus-tree-audit.md`. Relative to the first workspace folder. Empty opens it in an unsaved editor tab. |
| `mdHoi4Utilities.auditor.includeVanilla` | Also check the game's own focus tree files, not only the mod's. |

**Mod tools**

Some mods ship tools of their own with the extension, run with **Run Mod Tool...** in the command
palette. They are off until you turn on `mdHoi4Utilities.modTools.enabled`, and a mod's tools only
appear while that mod is open. Each mod that has tools gets its own **Mod tools: _mod name_**
section in the settings, with a switch per tool.

> **Mod tools are not supported by this extension.** They are written and maintained by the mods
> themselves. When one fails, the error names the mod team and links to their issue tracker:
> report it there, not here.

Settings that say so in their description need a window reload, or the preview reopened,
to take effect. **Show Index
Status** in the command palette tells you what the indexes are doing.

## Pre-release builds

Want the newest changes before they are released? Press **Switch to Pre-Release Version** on the
extension's page in VS Code; **Switch to Release Version** takes you back. Every build is also
attached to a [GitHub release][releases] as a `.vsix`, for installing a specific one by hand with
`Extensions: Install from VSIX...`.

## Contribute

Suggestions and bug reports are welcome on the
[GitHub repository](https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool/issues).

[marketplace]: https://marketplace.visualstudio.com/items?itemName=MilleniumDawnModTeam.hearts-of-iron-iv-utilities-2026
[openvsx]: https://open-vsx.org/extension/MilleniumDawnModTeam/hearts-of-iron-iv-utilities-2026
[releases]: https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool/releases
