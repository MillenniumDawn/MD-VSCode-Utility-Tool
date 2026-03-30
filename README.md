# HOI4 Utilities 2026

This extension add preview tools to Hearts of Iron 4 coding.
This is a continuation project based on the HOI4 mod utilities from herbix

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
|`hoi4ModUtilities.installPath`|`string`|Hearts of Iron IV install path. Without this, most features are broken.|
|`hoi4ModUtilities.loadDlcContents`|`boolean`|Whether to load DLC images when previewing files. Enabling this will use more memory (All DLCs are around 600MB).|
|`hoi4ModUtilities.modFile`|`string`|Path to the working `.mod` file. This file is used to read replace_path. If not specified, will use first `.mod` file in first folder of the workspace.|
|`hoi4ModUtilities.enableSupplyArea`|`boolean`|If you are developing mod for HOI4(version<=1.10). Use this to check enable supply area.|
|`hoi4ModUtilities.previewLocalisation`|`enum`|Language of content in event tree preview.|
|`hoi4ModUtilities.featureFlags`|`array` of `string`|Feature flags are used to disable or enable features. Reloading is required after changing this.

## Known Issues

* GUI of focus tree can't be configured like technology tree.
* Edge lines on world map not alway fit edge of colors.
* Event tree preview will duplicate events even they are same event if they are from different option.

## Contribute
* If you have any suggestion, feel free to create issue on this [Github repo](https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool).

## Original Tool Repo
- https://github.com/herbix/hoi4modutilities
