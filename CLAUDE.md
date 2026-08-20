# Project: MD VSCode Utility Tool

## Version & changelog — never by hand

**Do not bump the version and do not add a CHANGELOG entry on a feature branch.**
[package.json](package.json) and [CHANGELOG.md](CHANGELOG.md) stay untouched while
you are fixing a bug or building a feature.

Releasing happens after the merge, on its own:

1. A push to `main` whose version is already tagged, and that changed anything
   outside documentation and CI, makes
   [.github/workflows/version-bump.yml](.github/workflows/version-bump.yml) open a
   **release pull request** on branch `release/version-bump`.
2. That pull request carries the +1 patch bump and a `vX.Y.Z` section seeded with one
   bullet per pull request merged since the last release tag.
3. Whoever merges it rewords those bullets to the style below and adds
   `[ Component ]` prefixes. Merging it publishes the extension.

The version check on a pull request is advisory: it comments when the branch carries
no bump, and it never fails the check.

Bump by hand only when a branch has to ship its own version (rare), and then keep
`package.json` and the CHANGELOG heading at exactly the same version.

### Changelog writing style

Entries are for users of the extension, not for whoever wrote the code. Keep them
**short and plain**: one or two sentences per bullet, describing what is different
when you use the extension.

- Say what changed and, where it helps, why it was wrong before.
- No internals: no function names, no type names, no file paths, no counts of
  nodes, bytes or lint warnings, and no reasoning about how it was implemented.
- Game syntax (`random_list`, `var:my_array^0`, `FROM`) is fine, because that is
  what the reader has open in the editor.
- One bullet per user-visible change. If a change is only visible to a developer
  reading the source, it usually does not need a bullet at all.
- Reference the issue with a trailing `Issue #NN.` where there is one.
- Subsections are `  Functionality:` and/or `  Bugfixes:`, bullets start at the
  left margin with `- `.

Anything longer belongs in the pull request description, not in the changelog.

### In implementation plans
A plan that adds or changes functionality needs **no** version-bump or changelog
step. The release pull request covers both. What belongs in the pull request
description is the detail a reviewer needs; the changelog wording is written when
the release pull request is merged.
