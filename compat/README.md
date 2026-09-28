# Compat checks

The unit tests only see fixtures written by hand. The checks here run the extension against the
base game's layout and against real mods, so a name that only one mod has cannot slip in unnoticed.
Issues #448–#453 were names like that.

| File | What it is |
| --- | --- |
| `vanilla-manifest.json.gz` | Names only, no content: every file and folder the base game ships under `common`, `events`, `interface`, `gfx`, `map`, `history` and `localisation`, plus every sprite name in `interface/**/*.gfx`, and the game version. |
| `hardcoded-allowlist.json` | Game paths and `GFX_` names the extension names in its source that the base game does not have. Every entry has a reason, and an issue when it is a bug. |
| `mods.json` | The real mods the compat workflow checks. This is the only place a mod is named. |
| `baseline/<id>.json` | Problems already known for a mod. The workflow fails only on problems that are not listed here. |
| `baseline/vanilla-shaped.json` | The same, for the fixture mod in `src/test/fixtures/vanilla-shaped/`. |

## What runs where

- **`npm test`**:
  - `hardcodedpaths.test.ts` scans every non-test file in `src/`, plus the setting defaults in
    `package.json`, for game paths and `GFX_` names. Each one must be in the manifest or the
    allowlist. A failure names the file and line.
  - An allowlist entry that nothing uses any more fails too, so the pull request that fixes one
    removes it.
  - `vanillashaped.test.ts` runs every preview over the fixture mod with no game mounted.
  - `compatmods.test.ts` checks `mods.json`, and fails if a listed mod's id or repository appears
    in `src/`, `webviewsrc/` or `.github/`.
- **`.github/workflows/compat.yml`** runs on every pull request, one job per mod in `mods.json`:
  1. Checks out the mod at its pinned `ref`. It takes only the listed `paths` and never `gfx/`, and
     the checkout is cached.
  2. Runs the previews.
  3. Writes a table of counts per preview type to the job summary.

## The runner

```
npm run compat -- --mod <dir> [--game <installDir>] [--parent <dir>]... [--only focustree,event]
                  [--baseline <file>] [--update-baseline] [--report <file>] [--label <name>] [--verbose]
```

It runs each preview's own loader and content builder over the mod's files, the way the extension
does. The world map is not covered.

**What counts as a problem:** an exception, a parse failure, an error page, or an ERROR or WARN log
line.

**What is not counted:**
- The mod's own content warnings, which the preview shows to the modder.
- When `--game` is not given, a missing file that the manifest lists, or a missing image.

Some useful runs:

- The base game on its own: `npm run compat -- --mod "<HOI4 install>" --game "<HOI4 install>"`
- Your mod: `npm run compat -- --mod <your mod> --game "<HOI4 install>"`
- Only some previews: add `--only decision,mio --verbose`.

## Adding a mod

1. Add an entry to `mods.json`:
   ```json
   { "id": "my-mod", "repo": "owner/repo", "ref": "<full commit SHA>", "paths": ["common", "events", "interface", "localisation"], "parents": [] }
   ```
   - `paths` are the folders to check out. Do not list `gfx`.
   - `parents` are the ids of other entries that this mod is loaded on top of.
2. Check the mod out and write its baseline:
   ```
   node scripts/compat-checkout.js my-mod ../compat-mods > args.txt
   npm run compat -- $(cat args.txt) --baseline compat/baseline/my-mod.json --update-baseline
   ```
3. Commit both files.

## Bumping a `ref`

Change the `ref` in `mods.json`, then rerun step 2 above to write the new baseline. Read the diff of
the baseline in the pull request:

- A line that appears is something the mod's update broke in the extension.
- A line that disappears is something the update fixed, or something the mod stopped doing.

## After a game patch

1. Regenerate the manifest:
   ```
   node scripts/vanilla-manifest.js "<HOI4 install>"
   ```
2. Run `npm test`.
   - A name the patch removed now fails `hardcodedpaths.test.ts`. Fix the source, or allowlist the
     name with a reason.
   - A name the patch added may make an allowlist entry stale. Remove that entry.
