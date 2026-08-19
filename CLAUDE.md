# Project: MD VSCode Utility Tool

## Version & changelog — once per branch

Version bumps happen **once per feature branch**, not on every individual turn.
`package.json` and `CHANGELOG.md` are only updated at merge time (as part of a
closing commit, or in a separate PR that merges the branch).

Within one branch (or multiple turns on the same feature), the version stays stable.
Only when the entire feature is finalized:

1. **Bump the version** in [package.json](package.json) `version` field by **+1 patch**
   (e.g. `1.1.2` -> `1.1.3`).
2. **Add a new section at the top of [CHANGELOG.md](CHANGELOG.md)** with that same
   version as heading (`v1.1.3`), in the existing style:
   - Subsections `Functionality:` and/or `Bugfixes:`.
   - Bullets with `  - ` (two-space indent), like existing entries.
   - Use a `[ Component ]` prefix where appropriate (`[ Focus Tree ]`, `[ MIO ]`,
     `[ Technology ]`, ...).
3. **Keep `package.json` and the CHANGELOG heading at exactly the same version.**

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

Anything longer belongs in the pull request description, not in the changelog.

### In implementation plans
When you create a plan that adds or changes functionality, include the version bump
(+1 patch) and the corresponding CHANGELOG entry **as an explicit step in the plan
under "Finalize / merge"** -- not as an afterthought per turn. The changelog step
belongs to finalizing the feature, not to each intermediate commit.

### Enforcement
The `Stop` hook ([.claude/hooks/changelog-guard.js](.claude/hooks/changelog-guard.js))
has been adjusted or disabled for this workflow; follow the rule above at merges.
