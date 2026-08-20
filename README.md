# HOI4 Utilities 2026

This extension add preview tools to Hearts of Iron 4 coding.
This is a continuation project based on the HOI4 mod utilities from herbix
Very big shoutout to my friend AngriestBird for helping this project!

## Features

* World map preview
* Focus tree preview
* Event tree preview
* Technology tree preview
* Military industrial organization (MIO) preview.
* GUI preview
* `.gfx` file preview (sprites used by HOI4 are defined here)
* `.dds`, `.tga` file preview (images files used by HOI4)

## Steps to start

1. Install and enable this extension in VSCode.
2. Set Heart of Iron IV install path. You can:
    * (Since v0.7.0, or on [vscode web](https://vscode.dev)) Open command palette using `Ctrl+Shift+P`. Use command `Select HOI4 install path` to browse the folder that installed Heart of Iron IV.
    * Update setting `mdHoi4Utilities.installPath` (you can open settings page of VSCode using `Ctrl+,`) to the folder that installed Heart of Iron IV.
3. Open your mod develop folder.
4. (*Optional*) Open command palette using `Ctrl+Shift+P`. Use command `Select mod file` to set working mod descriptor (the `.mod` file).
5. Use these entries:
    * Command palette (`Ctrl+Shift+P`) commands: `Preview World Map` and `Preview HOI4 file`*.
    * `Preview HOI4 file` button on right-top tool bar of text editor.
    * Open a `.dds` or `.tga` file.

## Extension Settings

|Setting|Type|Description|
|-------|----------|--------|
|`mdHoi4Utilities.installPath`|`string`|Hearts of Iron IV install path. Without this, most features are broken.|
|`mdHoi4Utilities.loadDlcContents`|`boolean`|Whether to load DLC images when previewing files. Enabling this will use more memory (All DLCs are around 600MB).|
|`mdHoi4Utilities.modFile`|`string`|Path to the working `.mod` file. This file is used to read replace_path. If not specified, will use first `.mod` file in first folder of the workspace.|
|`mdHoi4Utilities.enableSupplyArea`|`boolean`|If you are developing mod for HOI4(version<=1.10). Use this to check enable supply area.|
|`mdHoi4Utilities.previewLocalisation`|`enum`|Language of content in event tree preview.|

## Known Issues

* GUI of focus tree can't be configured like technology tree.
* Edge lines on world map not alway fit edge of colors.

## Contribute
* If you have any suggestion, feel free to create issue on this [Github repo](https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool).

## Original Tool Repo
- https://github.com/herbix/hoi4modutilities
