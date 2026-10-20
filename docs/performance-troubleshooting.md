# Preview performance and troubleshooting

The extension has separate paths for image decoding and workspace indexes. On desktop, `.dds` and `.tga` decoding can use a pool of worker threads; indexes parse on the extension host through a shared queue. In vscode.dev, image decoding is synchronous on the extension host and indexes rebuild during each browser session. Tuning image workers does not speed up indexing, and indexing settings do not change image decoding.

## Image decoding

`mdHoi4Utilities.imageDecodeWorkers` defaults to `4` and accepts values from `1` through `16`. The pool starts small and grows only when concurrent decodes need more capacity. On desktop, a setting of `1` keeps conversion on one worker. A higher value can speed up a burst of `.dds` or `.tga` conversions on a machine with spare CPU. Each worker is a separate V8 isolate with its own memory overhead and working image buffers. A larger pool can use more CPU and memory, especially for large textures. It will not help when another part of rendering is the limit.

The worker pool converts `.dds` and `.tga` files to PNG. It is desktop-only, and web builds decode synchronously. `.png` files are never converted. They are passed through as they are, and the PNG header is only used to read their dimensions.

If a worker cannot start, all workers fail, or a single worker job fails, the decoder logs the error and retries that image synchronously. A worker job that runs for 30 seconds is treated as timed out. That image request then fails and is not retried synchronously, because the timed-out decode could freeze the extension host. A bad image can therefore be missing from the preview while the rest of the preview continues.

If an image is missing, first confirm that its `texturefile` path resolves to an existing `.dds`, `.tga` or `.png` file. A missing file is a user error. It goes to `debug()`, which writes to the console, and not to the **HOI4 Modding** channel. Unsupported or malformed image data is usually reported the same way.

`Failed to get image` appears in the **Output** panel's **HOI4 Modding** channel only for other failures, together with any image worker error. A synchronous retry can fail on bad image data, and raising the worker count does not repair an invalid file.

For slow image-heavy previews, compare the workload with `imageDecodeWorkers` set to a lower or higher value within its supported range. Watch CPU and memory use. After changing the setting, run **Developer: Reload Window** before each comparison. The worker cap is read once when the pool first needs to grow, and an existing pool does not re-read the setting or shrink. The README's browser support note describes the web synchronous path.

## Index settings

The README lists the index settings and what each one does under **Indexes and performance** in [Settings](../README.md#settings). Their defaults are in [package.json](../package.json).

Indexes are built lazily on first use. On desktop, their cache is under the extension's VS Code global storage, namespaced by the selected mod file, workspace folders, and resolved parent mods. The cache has a manifest with source file modification times; unchanged records can be reused and added, changed, or removed files are reconciled on a later build. Browser builds do not use the on-disk cache, so index data is rebuilt during each web session. Index watchers update already-built indexes as source files change.

Index parsing uses a shared queue of four tasks on the extension host. Parsing is synchronous work on that host thread, so increasing image workers cannot speed it up. Running more index parses at once would contend with editor messages instead of adding CPU capacity. The queue also yields between files so the editor keeps responding.

Native file walking helps list files. It does not change the parse queue or make the indexes memory-free. Turning off an optional index can reduce the data it holds and skip builds some previews do not need. The cost is the lookup feature that index provides.

## Diagnose a slow or stale preview

Use **Show Index Status** from the command palette while indexing seems slow. It reports whether an index build is active and includes its phase and progress when available. The same line is written to the **HOI4 Modding** output channel. A running line means the build is progressing or waiting on work; no active build means the delay is elsewhere in preview loading/rendering. Index builds have a five-minute caller timeout that logs the index name and live phases; it stops that caller from waiting, but does not cancel the underlying build. The cancellable indexing notification is the action that cancels a build.

For a slow first preview, allow the initial index build to complete and use the progress notification or **Show Index Status** to identify the active phase. The `HOI4 Modding` output channel records cache directory selection, index build start/completion/failure, and timer phase breakdowns when a build finishes. On later desktop builds, unchanged cached files can be reused. In vscode.dev, a new web session rebuilds indexes. No cache-clear command is provided by the extension; do not use an assumed setting or command to clear index state.

If a preview stays stale after editing a dependency file, confirm that the preview actually loaded that file as a dependency; only dependencies reported by the loader are watched. Editing the preview file itself follows its normal document refresh path. For image lookup problems, check the file path and image error logs as described above. For indexing problems, capture the exact line from **Show Index Status** and the relevant `[Index]` or `[Timer]` lines from **HOI4 Modding** when reporting the issue.

## Source

- [Settings and defaults](../package.json)
- [Image decoding, worker limits and timeout](../src/util/image/imagedecoder.ts)
- [PNG passthrough and image errors](../src/util/image/imagecache.ts)
- [Index parse queue, timeout, status command and `[Index]` logs](../src/util/indexBuild.ts)
- [Index work queue](../src/util/common.ts)
- [Cache lifecycle, stale-file checks and `[Timer]` logs](../src/util/indexCache.ts)
- [HOI4 Modding output channel](../src/util/logger.ts)
- [Browser support in the README](../README.md#browser-support)
