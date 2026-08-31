# Project: MD VSCode Utility Tool

## Version & changelog — never by hand

**Do not bump the version and do not add a CHANGELOG entry on a feature branch.**
[package.json](package.json) and [CHANGELOG.md](CHANGELOG.md) stay untouched while
you are fixing a bug or building a feature.

Releasing happens after the merge, on its own:

1. A push to `main` that changed anything outside documentation and CI makes
   [.github/workflows/version-bump.yml](.github/workflows/version-bump.yml) open a
   **release pull request** on branch `release/version-bump`.
2. That pull request carries the +1 patch bump and a `vX.Y.Z` section with one bullet per
   pull request merged since the last release tag. Each bullet arrives finished: the
   `[ Component ]` prefix comes from the files that pull request touched, the
   `Functionality:` / `Bugfixes:` split from its `enhancement` / `bug` labels, and the
   wording from a model called through OpenRouter, prompted with the style below.
3. **It stays open and updates itself.** Every later merge into `main` is merged into it
   and adds its bullets, so five merges in an afternoon become one release, not five.
   A bullet is written once and never rewritten, so editing one there is safe.
4. Whoever merges it reads the bullets and fixes anything that reads wrong. Merging it
   publishes the extension.

The wording is drafted, not authoritative — read it before merging. Everything degrades
to the pull request title if the model is unreachable, so a release never waits on it.
The two settings behind that are the `OPENROUTER_API_KEY` secret and the
`OPENROUTER_MODEL` variable; neither is required.

When the release pull request's changelog conflicts with `main` — a branch that wrote its
own section while it was open — the two are combined rather than left for a hand merge.
The release pull request's wording always wins, and only bullets it does not already
carry come across, matched on the sentence and on the issue number so a reworded bullet
and the raw title it came from are not both kept.

Nothing else publishes. A branch that does bump `package.json` no longer ships the moment
it is merged: the release pull request takes that version over and publishes it from
there, so the batching holds either way.

The version check on a pull request is advisory and quiet: leaving the version alone
passes without a comment. It only speaks up when a branch touched the version and got it
wrong — a version that already shipped, one below `main`, or a CHANGELOG heading that
disagrees — and even then it never fails the check.

Bump by hand only when a branch has to ship its own version (rare), and then keep
`package.json` and the CHANGELOG heading at exactly the same version.

### Changelog writing style

This section is also the prompt: [scripts/rewrite-bullets.js](scripts/rewrite-bullets.js)
carries the same rules, so changing one means changing both.

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
description is the detail a reviewer needs; the changelog wording is drafted from
the pull request title and body when the release pull request collects it.

Two things follow from that, for every branch. Write the **title** as the sentence
you would want in the changelog, because it is the fallback whenever the model is
unreachable and the starting point when it is not. And **label** the pull request
`bug` or `enhancement`, or close an issue that carries one, because that is what
decides whether the bullet lands under `Functionality:` or `Bugfixes:`.

## Writing a preview — the checks a green suite does not make

A preview is a loader, a payload and a webview, and the same handful of mistakes gets
through a passing test suite every time, because a fixture written by hand is tidier
than the mod. Before opening the pull request, walk this list against
`c:/Millennium-Dawn` rather than against the fixtures.

**The data.** Read the real files, not the documentation comment at the top of them —
it is out of date wherever the game has moved on.

- A block the game lets you **repeat** is repeated somewhere in the mod: three
  `advisor` blocks on one character, two `army = { }` portrait blocks on another. Every
  id the payload keys on has to survive that, occurrence index and all, or the webview's
  `id -> card` map keeps only the last one and draws it once per slot.
- A classifier of the form *"everything I do not recognise is a modifier, except these"*
  is only as good as its exception list. Enumerate the keys the mod actually writes and
  read the whole list:

  ```
  grep -rhP "^\t\t[A-Za-z_][A-Za-z0-9_]* *= *[^{ ]" common/unit_leader/*.txt \
    | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*) *=.*/\1/' | sort | uniq -c | sort -rn
  ```

  Then check the other direction: a key named in the exception list with no handler
  behind it is a whole feature the preview silently drops.
- Millennium Dawn writes `@constants` in `common/`, not only in scripted GUI. Anything
  whose values reach the reader is parsed with `parseAndResolveHoi4FileCached`.
- The mod's syntax is looser than the documentation: quoted where you expect bare,
  `0.` where you expect `0.0`, a date in four parts. Feed the parser a real file and
  count the failures before trusting it.

**The loader.** If it reads files besides its own, it owes them both halves: report them
in `dependencies`, *and* force the session on `dependencyChanged`. Reporting alone leaves
the panel repainting cached numbers, because the reload decision hashes the preview's own
document, which did not change.

**The webview.** `subscribeNavigators()` puts its click listener on the same element
`applyNav` marked, so an element with its own handler needs `stopImmediatePropagation()`;
stopping the bubble does nothing about a listener already on the element. Click
behaviour is only real in the wired page — test it in the `rendering` describe that
dispatches `load`, and assert on what reached the host, never on a detached element the
builder returned.

**Test it as the reader meets it.** One character with the same role three times; one
trait carrying the nested block, not just the flat one; one constant defined in the
fixture's own file; one quoted identifier; one dependency edit.
