# Project: MD VSCode Utility Tool

## Version & changelog — the version never by hand

**Do not bump the version on a feature branch.** [package.json](package.json) stays
untouched while you are fixing a bug or building a feature, and so does every `vX.Y.Z`
heading in [CHANGELOG.md](CHANGELOG.md).

**Write your changelog bullet under the `Unreleased` heading at the top of
[CHANGELOG.md](CHANGELOG.md).** That heading is the one part of the file a branch does
touch: add a `- ` bullet under its `  Functionality:` or `  Bugfixes:` subheading, in the
style below. It is a normal part of the change, reviewed with it, so nobody has to guess
your wording later.

Releasing happens after the merge, on its own:

1. A push to `main` that changed anything outside documentation and CI makes
   [.github/workflows/version-bump.yml](.github/workflows/version-bump.yml) open a
   **release pull request** on branch `release/version-bump`.
2. That pull request carries the +1 patch bump and renames `Unreleased` to `vX.Y.Z`,
   leaving a fresh empty `Unreleased` above it for the branches that come next. Any pull
   request that shipped without writing its own bullet gets one seeded from its title:
   the `[ Component ]` prefix comes from the files it touched, the
   `Functionality:` / `Bugfixes:` split from its `enhancement` / `bug` labels, and the
   wording from a model called through OpenRouter, prompted with the style below. A seeded
   bullet is dropped when a hand-written one already covers the same change, matched on the
   sentence and on the `Issue #NN` trailer.
3. **It stays open and updates itself.** Every later merge into `main` is merged into it
   and adds its bullets, so five merges in an afternoon become one release, not five.
   A bullet is written once and never rewritten, so editing one there is safe.
4. Whoever merges it reads the bullets and fixes anything that reads wrong. Merging it
   publishes the extension.

The wording is drafted, not authoritative — read it before merging. Everything degrades
to the pull request title if the model is unreachable, so a release never waits on it.
The two settings behind that are the `OPENROUTER_API_KEY` secret and the
`OPENROUTER_MODEL` variable; neither is required.

### The release bot

Everything the automation publishes is published by **MD Utilities Release Bot**, a GitHub
App owned by the `MillenniumDawn` organisation and installed on this repository: it opens
and pushes the release pull request, and it authors the GitHub release and every
pre-release. Its two secrets are **required** — `RELEASE_PR_APP_ID` and
`RELEASE_PR_APP_PRIVATE_KEY` — and without them the publish and release pull request
workflows fail at their first step. The App needs four repository
permissions: Metadata read, Contents read & write, Pull requests read & write, and
Workflows read & write. The last one is not optional: the release branch merges `main`,
so its push carries any change to `.github/workflows/**`, and GitHub rejects such a push
from an App without it.

The point of the App, beyond one identity for everything MD publishes, is that a pull
request opened by an App installation token starts workflow runs. A pull request opened
with `GITHUB_TOKEN` starts none, which is why the release used to be the one thing nobody
tested. The release pull request now runs the test and version checks against its own
merge commit, like any other branch.

When the release pull request's changelog conflicts with `main` — a branch that wrote its
own section while it was open — the two are combined rather than left for a hand merge.
The release pull request's wording always wins, and only bullets it does not already
carry come across, matched on the sentence and on the issue number so a reworded bullet
and the raw title it came from are not both kept.

A branch that does bump `package.json` no longer ships the moment it is merged: the
release pull request takes that version over and publishes it from there, so the batching
holds either way.

### The Publish workflow

Both channels come out of [.github/workflows/release.yml](.github/workflows/release.yml),
in one run per push to `main`, because a release that is a black box is a release nobody
can debug. `check` decides whether this push is the release; `verify` lints and tests it
once; then a build job packages the `.vsix` and hands it to **three sibling jobs — VS Code
Marketplace, Open VSX, GitHub release — that publish in parallel**. They are siblings on
purpose: as steps in a row, a Marketplace outage took Open VSX and the GitHub release down
with it, and re-running meant re-running all three. Now the Actions graph names what broke
and re-running one job republishes one target.

**A registry with no token fails.** It used to skip and leave the job green, which is how
the extension reached nobody on Open VSX for months while every run said success. `VSCE_PAT`
and `OPEN_VSX_TOKEN` are both required, and the error says what to create and where. Open VSX
also needs the publisher namespace to exist before the first publish
(`npx ovsx create-namespace <publisher> -p <token>`, once).

**A failed release leaves somewhere to fix it.** When any `Release:` job fails, the bot
pushes `fix/release-v<version>` — the failing commit plus one empty commit — and opens a
**draft pull request** whose body lists every job in the run with a link to its log, so what
already reached a registry is visible without opening anything. Nothing to clean up: push the
fix, mark it ready, merge. **That merge is the release**: `release-check.js` recognises the
branch name and publishes the version again, tag or no tag, and every target treats a
version it already has as done (`--skip-duplicate` on the Marketplace, `skipDuplicate` on
Open VSX, an in-place update of the GitHub release), so only what failed actually changes. No
second release pull request is involved. The one thing to remember: if the fix changes what
ships — anything outside `.github/` and documentation — bump `package.json` and the
`Unreleased` heading on the fix branch first, or the new build replaces `v<version>` on the
targets that already have the old one. If the branch already has an open pull request,
someone is on it, and the new run is reported as a comment rather than force-pushed over. A
failed *pre-release* gets none of this — it runs on every push and the next one supersedes it.

**The Marketplace publish retries.** A `Request timeout: /_apis/gallery` once failed a
release whose build had nothing wrong with it. `scripts/publish-marketplace.js` now runs
`vsce publish` up to three times, pausing between, when the failure reads like the gallery or
the network rather than the extension; a rejected token or a bad manifest fails at once.

The pre-release half builds every push to `main` and publishes it to both registries on the
**pre-release** channel, plus a GitHub prerelease with the `.vsix` attached. It is skipped on
the push that is a release, which otherwise shipped the same code twice. It touches nothing in
the repository: the version it packages is written into its own checkout and thrown away, and
`CHANGELOG.md` is never part of it. Pre-release versions take the odd minor above the stable
line with the run number as the patch — `1.3.57` while stable is `1.1.x` — which is why a
minor bump steps `1.1 -> 1.2 -> 1.4`, over the pre-release line rather than onto it.

One publish at a time, and never cancelled: a run that may be halfway through a registry
waits for the one ahead of it rather than being dropped.

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
A plan that adds or changes functionality needs **no** version-bump step — the
release pull request covers that. It does need a **changelog step**: one bullet
under `Unreleased`, in the style above. What belongs in the pull request
description is the detail a reviewer needs, not that bullet.

Two things follow from that, for every branch. Write the **title** as the sentence
you would want in the changelog, because it is what a bullet is seeded from if you
did not write one. And **label** the pull request `bug` or `enhancement`, or close
an issue that carries one, because that is what decides whether a seeded bullet
lands under `Functionality:` or `Bugfixes:`.

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
