<p align="center"><img src="icon.png" width="160" alt="Millennium Dawn – HOI4 Utilities"></p>

# HOI4 Utilities 2026

**See your Hearts of Iron IV mod the way the game will draw it — without launching the game.**

Open a focus tree, an event file, a decisions file, an ideas file or the map folder, press the
preview button, and the extension renders it next to your code with the game's own icons and
textures. Edit the file and the preview follows. Click anything in the preview and the editor
jumps to where it is defined.

Works in VS Code on the desktop and in the browser at [vscode.dev](https://vscode.dev).
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

**In every preview.** Zoom with the mouse wheel, Ctrl+wheel, the zoom buttons or the +/- keys;
pan with the trackpad. Click an element to jump to its definition. Text comes from your
localisation files, in the language you choose. Vanilla and DLC content is read from your game
install, and the mod's `.mod` file is honoured for `replace_path`.

## Get started

1. Install the extension.
2. Open the command palette (`Ctrl+Shift+P`) and run **Select HOI4 Install Path** to point the
   extension at your Hearts of Iron IV installation.
3. Open your mod folder. If it holds more than one `.mod` file, run **Select Mod File** to choose
   the one to work with.
4. Open a file and press the preview button in the editor's title bar, or run **Preview HOI4
   file** from the command palette. **Preview World Map** opens the map.

## Settings

| Setting | What it does |
|---|---|
| `mdHoi4Utilities.installPath` | Hearts of Iron IV install path. Without it most previews have no icons. |
| `mdHoi4Utilities.modFile` | The `.mod` file to read `replace_path` from. Defaults to the first `.mod` file in the workspace. |
| `mdHoi4Utilities.loadDlcContents` | Load DLC images when previewing. Uses more memory. |
| `mdHoi4Utilities.previewLocalisation` | Language of the text shown in previews. |
| `mdHoi4Utilities.previewWheel` | What a plain mouse wheel does: `auto` (zoom for a mouse, scroll for a trackpad), `zoom` or `scroll`. |
| `mdHoi4Utilities.useConditionInFocus` | Show conditions in the focus tree preview. |
| `mdHoi4Utilities.inlayWindowGfxRoots` | Folders scanned for the `.gfx` files that focus inlay windows use. |
| `mdHoi4Utilities.technologyGfxRoots` | Folders scanned for `.gfx` files used by the technology tree, including country-specific icons. |
| `mdHoi4Utilities.technologyCountryIcons` | Add a country selector to the technology tree preview and prefer that country's icons. |
| `mdHoi4Utilities.eventTreePreview`, `decisionPreview`, `ideaPreview`, `characterPreview` | Turn an individual preview on or off. |
| `mdHoi4Utilities.sharedFocusIndex` | Index shared focuses so other trees can pull them in. |
| `mdHoi4Utilities.ideaSwapIndex` | Scan `common` and `events` for `swap_ideas` so the idea preview can draw idea chains. |
| `mdHoi4Utilities.gfxIndex` | Index every sprite definition. Faster icon lookups, more memory. |
| `mdHoi4Utilities.localisationIndex` | Index localisation so previews show translated text. Uses more memory. |
| `mdHoi4Utilities.imageDecodeWorkers` | Threads used to decode `.dds` / `.tga` images. More is faster on icon-heavy trees. |
| `mdHoi4Utilities.worldMapRetainContextWhenHidden` | Keep the world map loaded while its tab is hidden. Faster to switch back, more memory. |
| `mdHoi4Utilities.enableSupplyArea` | Show supply areas, for mods targeting HOI4 1.10 or older. |

Settings that say so in their description need a window reload to take effect. **Show Index
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
