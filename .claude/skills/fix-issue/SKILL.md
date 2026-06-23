---
name: fix-issue
description: Find an actionable GitHub issue and fix it (or scan the TypeScript codebase for common bug patterns), then open or update a pull request.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
---

# /fix-issue — Fix a GitHub issue and open a PR

Find an open GitHub issue that is actionable and fix it, then open a pull request. If no
actionable issues remain, scan the TypeScript codebase for common bug patterns instead.

This repo is **MD-VSCode-Utility-Tool**, a VSCode extension (TypeScript) that parses Hearts of
Iron IV files and renders previews in webviews. The source is in `src/` (extension host) and
`webviewsrc/` (webview). GitHub repo: `MillenniumDawn/MD-VSCode-Utility-Tool`.

Supported arguments: an issue number to fix a specific issue, or none to auto-select one.
Requested arguments: $ARGUMENTS

## Steps

### 1. Find an issue to fix

If an issue number is given, fetch it directly:

```
gh issue view <number> --json title,body,labels,comments
```

Otherwise, list open issues and pick one that is not already covered by an open PR:

```
gh issue list --state open --limit 40
gh pr list --state open
```

Prefer issues labelled `bug` with a clear reproduction path. The repo also uses domain labels
(`Focus Tree Previewer`, `MIO Previewer`) that tell you which subsystem is involved. Skip issues
that already have an open PR, are vague with no reproduction steps, or are pure enhancement
requests with no concrete defect.

**If no actionable GitHub issue remains** (all too vague, enhancement-only, or already covered),
scan the codebase for common bug patterns instead. Scope searches to `src/` and `webviewsrc/`:

```
grep -rn "keyword" src/ webviewsrc/ --include="*.ts"
```

Patterns to look for:

- **Floating promises / missing `await`** — an async call whose result is never awaited, so
  rejections are swallowed and ordering races (e.g. a preview refresh that fires before its load
  resolves).
- **Undisposed resources** — a `Disposable`, event listener, file watcher, or webview panel that
  is never pushed to `context.subscriptions` or otherwise disposed, leaking across preview
  reopen.
- **Stale cache** — a cache keyed without a file version / mtime, or not invalidated when the
  document changes (relevant to the localisation and icon caches; cf. issues #26/#27).
- **Case-sensitive key lookups** — comparing HOI4 tokens or localisation keys without
  normalising case first, so a valid key silently fails to resolve.
- **Webview message mismatches** — a `command` / message `type` posted with no matching `case`
  in the handler, or a payload shape that differs between the `postMessage` sender and the
  receiver.
- **Unguarded parsing** — `JSON.parse` or the HOI4 parser run on malformed / unexpected input
  without a `try/catch`, or a new syntax variant the schema or matcher does not handle (cf.
  issue #32).
- **Windows path handling** — string-concatenated paths or `\` vs `/` assumptions instead of
  `path.join` / `vscode.Uri.joinPath`.
- **Off-by-one / out-of-bounds** — bad indexing in the token parser or array slicing.
- **Regex bugs** — a missing global flag in a replace loop, or unescaped input interpolated into
  a `new RegExp(...)`.
- **Unguarded null/undefined access** — `a.b.c` where `b` may be absent, or an optional schema
  field treated as required.
- **Numeric parsing** — `parseInt` without a radix, or a `parseFloat` result used without a
  `NaN` check.
- **Silent map overwrites** — a loader building a `Map`/object where duplicate keys silently
  overwrite earlier entries.
- **Image-decode leaks** — DDS/BMP/TGA buffers or decoders not released after use.

When fixing a codebase-scanned bug, omit the `Closes #` line from the PR since there is no issue
to reference.

### 2. Understand the bug

Read the issue body. Identify the wrong behaviour, the expected behaviour, and any preview type,
command, subsystem, or file named in the report.

### 3. Locate the relevant code

Search the subsystem that owns the behaviour:

- Previews: `src/previewdef/{focustree,technology,mio,event,gui,gfx,worldmap}/`
- HOI4 parsing / schema: `src/hoiformat/`
- Shared utilities (caching, localisation, image processing, GFX index): `src/util/`
- Webview rendering: `webviewsrc/`

Use Grep/Glob first. If a named symbol is not found, widen the search:

```
grep -rn "keyword" src/ webviewsrc/ --include="*.ts" -l
```

Read the files involved and understand the data flow before touching anything.

### 4. Diagnose the root cause

Trace the logic to find exactly where the wrong value is produced or the wrong branch is taken.
Do not guess; confirm the cause in code before writing a fix.

### 5. Fix the bug

Make the minimal change. Follow this repo's conventions:

- Tabs for indentation.
- Semicolons required (`semi`).
- `===` / `!==`, never `==` / `!=` (`eqeqeq`).
- Curly braces around all control-flow bodies (`curly`).
- Throw `Error` objects, never string literals (`no-throw-literal`).
- No empty blocks, no commented-out code.
- Only add a comment if the fix is non-obvious.

Do not refactor surrounding code or fix unrelated issues in the same commit.

### 6. Verify the fix

Before committing, run the repo's checks and make sure they pass:

```
npm run lint
npm test
```

If types changed, also run `npm run compile-ts`. If a check fails, fix the cause before
continuing — do not commit failing code.

### 7. Commit

Never create or switch branches on your own. First check the current branch:

```
git rev-parse --abbrev-ref HEAD
```

- If on **`main`**: stop and use `AskUserQuestion` to ask which branch to use. Offer: (a) check
  out an existing branch (user supplies the name), (b) create a new branch (user supplies the
  name). Only after the user answers, run `git checkout <name>` or `git checkout -b <name>`. Do
  not invent a branch name.
- If **not on `main`**: commit on the current branch. Do not switch or create a branch.

Then stage only the files changed for this fix and commit. **Do not add a `Co-Authored-By`
trailer.**

```
git add <files>
git commit -m "Fix <short description> (#<issue number>)

<one or two sentences explaining root cause and fix>"
```

### 8. Version bump + changelog

This repo's `changelog-guard.js` Stop hook blocks any code-changing turn that lacks a patch bump
and a matching changelog entry, so do both as part of the fix:

1. Bump the `version` field in [package.json](../../../package.json) by **+1 patch**
   (e.g. `1.1.10` -> `1.1.11`).
2. Add a new `vX.Y.Z` section at the top of [CHANGELOG.md](../../../CHANGELOG.md) with that same
   version, in the existing style:
   - `  Bugfixes:` (or `  Functionality:`) subsection header, two-space indent.
   - Bullets `  - [ Component ] ...` with a component prefix (`[ Focus Tree ]`,
     `[ Technology ]`, `[ MIO ]`, `[ Previewer ]`, `[ Build ]`, `[ CI ]`, `[ HTML ]`,
     `[ Testing ]`, ...).
   - Substantive and encyclopedic: describe what was wrong and how it is fixed.
3. Keep the `package.json` version and the CHANGELOG heading identical.

If a section for the current unreleased version already exists at the top of the branch's
`CHANGELOG.md`, append a bullet under it instead of adding a duplicate heading (and leave the
version as-is). Commit the version + changelog change separately from the code fix.

### 9. Ensure the branch is up to date

```
git merge origin/main
```

Resolve any conflicts before pushing.

### 10. Open or update the pull request

Push the branch first:

```
git push -u origin <branch>
```

Then check whether an open PR already exists for this branch:

```
gh pr list --head <branch> --state open --json number,url,body
```

**a. If no open PR exists**, create one. Use this repo's PR-body format and apply with a heredoc
so the formatting survives:

```
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
- **<one-line headline>**: <what changed and why>.

Closes #<issue number>

## Test plan
- [ ] <how to reproduce the original bug and confirm it is gone>
- [ ] <any regression check>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Omit the `Closes #...` line when the fix came from a codebase scan with no issue.

**b. If an open PR already exists**, rewrite its body to include the new fix; do NOT create a
second PR.

- **Preserve every existing `Closes #N` line**, then append a new `Closes #<this issue number>`.
- **Preserve every existing `## Summary` bullet**; append a new bullet, never replace prior ones.
- **Preserve every existing `## Test plan` bullet**; append new bullets for the new fix.
- Keep the `🤖 Generated with [Claude Code]` footer.

Apply with a heredoc to keep formatting intact:

```
gh pr edit <PR#> --body "$(cat <<'EOF'
<full rewritten body>
EOF
)"
```

### 11. Report back

Output the PR URL, whether the PR was **created** or **updated**, and a one-paragraph summary of
the root cause and fix.
