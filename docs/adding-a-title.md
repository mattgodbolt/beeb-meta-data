# Adding a title

What we learned adding a big batch of games and ROMs at once, written down so the next ones are quick. The reference
for each importer and config field is [the importers' doc](symbol-importers.md); this is the order to do things in and
the rules we kept having to rediscover.

## Data and tooling are separate pull requests

Most of the cost of that batch was importer work that turned up halfway through a title: py8dis couldn't pick a piece
by name, beebasm lost `.*` labels and macro labels, acornaeology could only do one version a config, and so on. Each
fix then needed tests, every existing set regenerated, and a full review, all inside a pull request that was meant to
add a game.

So: if a title needs the importer or the checks to change, stop, make that change on its own (with a test, and every
existing set regenerating unchanged), land it, and then add the title. A title's own pull request is a config, a check
module and its sets (with the index and titles list they remake), and its notes in the docs: a paragraph under its
importer in [the importers' doc](symbol-importers.md), and a row in `symbols/README.md`'s source table unless it's one
more level7 title. Nothing else. That's also what lets titles be added in parallel without stepping on each other; when
two land, the second merges `main` and reruns `npm run build-index`, since the index and the titles list are made from
every set.

## Picking up work

[The titles list](../symbols/titles.md) is what's done. The issues are what isn't: titles and tools a session can
take, and design work (records, fingerprints, the proposal's open questions) that's the maintainer's unless he says
otherwise. An issue labelled `blocked`, or one that says it waits on something (the maintainer, a disc, another pull
request), isn't ready; ask rather than start it. Take one that is, add it on its own `claude/<name>` branch as below,
and open a pull request for it.

When the issues run out, more titles come from level7's [index](https://www.level7.org.uk/miscellany/), py8dis's
`examples/python`, and authors' own repositories with a licence. Check the titles list first: a title with a set
doesn't get a second one over the same code without asking. A new candidate becomes an issue before the work starts.

Before the first one:

- `npm ci`, and again whenever `package-lock.json` moves jsbeeb's pin. A jsbeeb older than the pin is the usual
  reason for a pile of failing tests after a pull.
- `node tools/registry/fetch-corpus.js --only sth-disc,sth-tape` fills `.registry-corpus/` (ignored by git) with
  Stairway to Hell's discs, which the corpus check and the in-memory check read, and its tapes, for finding a tape
  title's image. If another checkout has a `.registry-corpus`, pass it with `--corpus` instead of fetching again.
- The assembler or Python the title's importer needs; [the importers' doc](symbol-importers.md#running-it) says where
  to get each.

The tools name a corpus disc three ways: `image-entry.js` by its path under the corpus (`sth-disc/AnF/ChuckieEgg.zip`),
`level7-compare.js --disc` by its path in Stairway to Hell's archive (`AnF/ChuckieEgg`), and `corpus-check.js --corpus`
by the mirror's directory (`.registry-corpus/sth-disc`).

## The steps

1. Find a source you can use. It needs a licence that allows reuse (not the GPL; see "Licensing" in [the design
   notes](media-registry-design-notes.md#licensing)), and you need to know whose names they are. Read the source's own
   import tools and history, not just its LICENSE: acornaeology's ADFS names were seeded partly from an
   unlicensed disassembly, in ways its history can't separate, which is why there's no ADFS set.
2. Find the bytes to check against. A disc in Stairway to Hell's archive (`.registry-corpus/sth-disc`), a ROM jsbeeb
   ships, or a ROM pinned by URL and key. `node tools/symbols/image-entry.js sth-disc/<path>.zip` prints a disc's
   `disc` entry for the config (its URL, image and key) and each file with where it loads and runs; `sth-tape/...`
   does the same for a tape's `tape` entry, and a local `.ssd` gives a repository's own disc's key. For a ROM jsbeeb
   doesn't have, mdfs.net's archive with MAME's `bbc_rom.xml` hashes as a cross-check has usually worked.
3. Start the config from the nearest existing one. For level7, `level7-compare.js --draft` writes the config and the
   check for you. For the others, copy the config of the title most like it (a game, a ROM, a multi-load), and find
   the regions by hand: where the files load and run (`image-entry.js`), where the code moves itself (the source's
   copy loops, which go in `moves`), and what gets overwritten once it has run. Import with `--verbose`, check in
   memory, and adjust. A config with more than one set needs a `name`, its title in
   [the titles list](../symbols/titles.md).
4. Write the check with the shared scenarios. `playScenario` (boot, start keys, a routine that only runs in a game,
   random play) or `typedScenario` for a text adventure, from `title-scenario.js`. A title-specific scenario is only
   for what those can't do.
5. Look at the screenshots (`check-memory.js --shots`). A check that passes on a demo mode or a title screen is
   checking the wrong thing; two titles in the batch did exactly that.
6. Run the corpus check, and explain or remove every collision. A collision is usually a cheat or a hack that keeps
   some of the code and changes the rest. Split the region where they part, so the shared part matches them and the
   rest doesn't, and keep its anchors off the bytes they share with `avoid` (Chuckie Egg's `front`, in
   [the importers' doc](symbol-importers.md#chuckie-egg)); or add anchors with `bytesPerAnchor`; or leave out
   run-once loader code a crack patches. One you can't remove goes in the pull request with why it's harmless.
7. Open the pull request, saying how it was checked and that nobody has looked in a browser if nobody has.

## The rules

These were each settled by a review, some more than once.

- Credit the person whose names they are, not just the project they came through: Plan B's and LISP's names are
  TobyLobster's, even though they came from py8dis's examples. Link each name to its place on their site.
- A ROM's set has no `globals` until jsbeeb scopes them
  ([jsbeeb#1252](https://github.com/mattgodbolt/jsbeeb/issues/1252)). A set matches whenever its ROM is paged in, and a
  filing system's ROM stays paged in while a game runs, so its workspace names land on the game's memory. The MOS's
  set is the exception.
- A program's globals name only its own memory. OS variables, vectors and hardware registers belong to the MOS's set,
  and the importers leave a program's names for them out: a source's names for them are guesses and are often wrong
  (Frogman's and XMOS's sources had several). The exception is zero page and page 3 (the VDU and cassette workspace) the
  program's own code stores to, which it keeps its own variables in (Exile's `player_angle` at `&DE`), so it keeps those
  names beside the MOS's; but not `&F4` or `&FC`, which games write in the MOS's sense. Leave out any other wrong name
  with `leaveOut`, and fix it upstream.
- A change to a system set can change other titles' sets, since they leave its addresses to it. After one, re-run
  every importer (`npm run reimport-all`, which needs every importer's tools) and keep what changes.
- Leave out names that aren't names: a script's placeholders (`nmi_XXX1`), and names on bytes that differ in the
  copy a region also matches (`sameCodeIn`).
- Cut regions at screen memory, and give run-once loader code its own `overwritten` region, or none at all if a
  cheat disc or compilation holds its anchors.
- Two regions of one set may share addresses, as long as their anchors tell them apart; the importer and the
  corpus check say when they don't.
- When two versions share code byte for byte, only one set can name it; the older version's region keeps it and
  the newer set names only what changed (NFS 3.62, ANFS 4.26).

## Reviewing

A title's pull request is checked by CI (the index, the sets against jsbeeb's parser) and by its in-memory check.
It still runs the `local-review` skill, but its review can be short: brief the reviewer with the licence and credit,
the screenshots, and a sample of names against the source. The full adversarial review is for tooling, where the bugs
were.
