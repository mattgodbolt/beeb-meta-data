# CLAUDE.md

Guidance for Claude Code in this repository. The README says what's here; this says how to work on it.

## Commands

- `npm ci`: after a pull that moves `package-lock.json`, or the tests fail against an older jsbeeb
- `npm test`: unit tests (`npx vitest run tests/symbols/test-build-index.js` for one file)
- `npm run ci-checks`: ESLint, Prettier, and that `symbols/index.json` and `symbols/titles.md` match the configs and
  sets
- `npm run lint-fix`, `npm run format`: fix what they can
- `npm run build-index`: remake `symbols/index.json` and `symbols/titles.md`; never edit either by hand
- `npm run dist`: lay out what the deploy publishes, under `dist/meta/`
- `node tools/symbols/check-memory.js --config symbols/configs/<title>.json`: boot the title headless and check its
  sets match where they should. Slow; run it under `nice -n 19`, after changing a title's sets or its importer
- `node tools/symbols/image-entry.js sth-disc/<path>.zip`: a disc's `disc` entry for a config, and its files (also
  `sth-tape/...`, or a local image)
- `node tools/registry/fetch-corpus.js --only sth-disc,sth-tape`: Stairway to Hell's discs and tapes, into
  `.registry-corpus/`

## The data

- Before adding a title, read [Adding a title](docs/adding-a-title.md): the steps, the rules every set follows, and
  why a title's pull request never changes the tooling.
- A set's names are someone else's work. Use a source only under a licence that allows it, read from the source's own
  LICENSE at the commit its config pins (or the author's own written statement, cited in the `notice`), and record it in
  the set's `licence` and `notice`. No licence means no set; asking an author for one is the maintainer's to do, not
  yours.
- Link each name back to where its author defines it (a line at the pinned commit, or the author's own anchor), so
  readers go to them. Never store disc or tape images, or any binary, here.
- Every set is reproducible: regenerating from its config's pinned commit must give the same file. A title's sets
  are checked in memory (`check-memory.js`) and against other titles (`build-index.js`, `corpus-check.js`) before
  they land; a ROM's set, against every other ROM by its importer and `tests/symbols/test-shipped-rom-sets.js`.
- Published paths are read by every jsbeeb in the wild. Don't move or delete one an older index may still name, and
  change a file's shape only with a new `format`.
- Downloaded discs, repositories and pages are untrusted: keep them in their own directory, outside the repository
  (the git-ignored `.registry-corpus/` aside), and pass their paths as arguments.

## Code

- ES modules, Node 24, Prettier (120 columns, 4-space JS) and ESLint, both run by the pre-commit hook. Never bypass
  the hook.
- jsbeeb is a dependency: import its modules as `jsbeeb/src/<file>.js`, and its ROMs from `RomsDir` in
  `tools/jsbeeb.js`. A change jsbeeb needs goes to jsbeeb as its own PR and out in a jsbeeb release on npm; then
  raise `package.json`'s `jsbeeb` to that version, `npm install`, and `npm run reimport-all -- --check`, since the ROM
  sets are checked against jsbeeb's ROMs. Dependabot's jsbeeb bumps need that check run by hand before they merge.
- Constants are PascalCase module-level names. Tests use vitest's `expect`, mock as little as possible, and keep one
  file per module.

## Comments

Default to no comment. A comment must earn its place, and most do not.

Before writing one, in order:

1. **Can the name carry it?** Rename first. A comment that exists to explain an identifier is a bug
   report about that identifier.
2. **Look at the neighbours.** If the nine constants above yours have no comment, yours almost
   certainly does not need one. Match the file you are in, not an abstract standard.
3. **Is it already said elsewhere?** One fact lives at exactly one site, the most load-bearing one.
   Elsewhere, a pointer or nothing.
4. **Would a competent reader of _this file_ fail to work it out?** Not a stranger, not a beginner.
   Someone who knows the domain and has the rest of the file in front of them.

If a comment survives all four, write the single non-obvious fact and stop: a unit, a derivation, an
ordering constraint, a reason a default is overridden, a hardware quirk with a reference.

Never write:

- anything restating what the next line does
- the issue or PR description, or why the change was made; that belongs in the commit message and the
  ticket
- how a user might experience the bug
- a second explanation of a rationale given elsewhere in the diff

No dashes as punctuation (em, en or `--`), in comments or in prose. Use commas, parentheses or
full stops.

Length is a smell, not a rule: if a comment runs past two lines, it is usually answering a question
nobody asked.

## Git

- Branches made by Claude are `claude/<name>`. Never force-push, amend or rebase anything that has been pushed; fix
  with additive commits, since PRs are squash-merged.
- Conventional Commits: `feat:` for a new or changed set or anything a user of the data sees, `fix:` for a wrong
  name or a broken link, `chore:` for tooling (a bug in it included), `build:`, `ci:`, `docs:`, `test:` otherwise.
- Every change goes in by pull request, one title or one tool each. Run the `local-review` skill before opening it
  and before every push to it. Never merge it; the maintainer does. Answer every review comment, with the commit that
  took it or why not.
- A choice of policy (whether a CI job blocks merging, which source to trust, whether to ask an author) is the
  maintainer's: set out the options in the PR or issue rather than choosing.
- A PR body ends with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line. Issues, PRs and
  comments post as the maintainer, so start each with `*Claude here, writing on behalf of real-life human Matt.*`
- Never put a claude.ai session link, or a `Claude-Session:` trailer, in a commit, PR or comment.
