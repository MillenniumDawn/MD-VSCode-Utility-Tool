# Mod tools

Everything else in this extension works for any Hearts of Iron IV mod, and the compat checks keep it
that way (`compat/README.md`). A mod that wants a tool only it can use — a scaffolder for one of its
own systems, say — ships it here, as a **pack**, kept apart from the rest of the extension.

## Support: the pack belongs to the mod

**The extension hosts mod tools; it does not support them.** A pack is written, reviewed for its mod
logic, and maintained by the mod team it names as `maintainer`. Users are told so in the settings,
in the README, in the bug report template, and in every error a failing tool shows, which names the
maintainer and links to their issue tracker.

What the extension's maintainers do is hold a pack to the bar below. What they do not do is fix a
pack's behaviour, answer issues about it, or keep it working through a change in its mod. A pack that
breaks CI, falls below the bar, or goes unmaintained is switched off or removed, without a
deprecation cycle.

## The bar a pack has to meet

The same as any other change to this extension:

- `tsc` and ESLint clean, and `npm test` green, including `modtoolssettings.test.ts`.
- Tests for its pure helpers: argument building, parsing what it reads, validation.
- Every string a user sees goes through `localize` (`i18n/en.ts`) or an `%nls%` key in every
  `package.nls*.json` and its `i18n/` copy.
- `desktopOnly: true` when it needs Node (`child_process`, `fs`), with the `require` behind
  `!IS_WEB_EXT` the way `src/util/fileloader.ts` does it, so the web bundle never references it.
- `requiresTrust: true` when it runs or reads anything from the workspace.
- `detect.files` that only its mod has, so it never shows in anyone else's workspace.
- No imports into it from outside `src/modtools/packs/<id>/` other than `registry.ts`. It may
  import the extension's utilities; nothing in the extension may import it.
- A `CHANGELOG.md` bullet under `Unreleased`, like any other change.

## Adding a pack

1. Create `src/modtools/packs/<id>/index.ts` exporting a `ModToolPack` (`api.ts`), with its
   `maintainer`. `<id>` is camelCase.
2. Add it to `modToolPacks` in `registry.ts`.
3. Give it a settings page of its own in `package.json`: a new entry in
   `contributes.configuration` with the next free `order`, a title `%hoi4modutilities.section.modTools.<id>%`
   ("Mod tools: _mod name_"), and one boolean per tool, `mdHoi4Utilities.modTools.<id>.<toolId>`,
   `default: true`. Say in the section's settings that the pack is maintained by the mod.
4. Add the nls keys in every language.

Nothing else: the pack's tools appear in **Run Mod Tool...** once `modTools.enabled` is on and its
mod is open, and `modtoolssettings.test.ts` checks the pack and its settings page against each other.

## How the host keeps packs apart

- `extension.ts` imports `host.ts` and nothing else from this folder, and registers it last, after
  the extension counts as loaded. Registration never throws.
- Nothing is looked at while `modTools.enabled` is off, which is the default.
- Finding a pack's mod and running a tool are each guarded on their own: a pack that throws is
  logged to the HOI4 Modding output channel and left out, and the other packs carry on.
- `hardcodedpaths.test.ts` and `compatmods.test.ts` skip `packs/`, and nowhere else.
