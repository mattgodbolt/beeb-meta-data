# A media registry for BBC Micro software

The registry lets an emulator work out what it has just loaded and find out a bit about it. There are two
kinds of data. Symbol sets name the code and data of programs in a debugger, and they're built and in use
by jsbeeb's debugger. Records say what a disc or tape is (its title, which machine it needs, its keys), and
they're still a proposal to pick holes in. Everything is static JSON under `https://bbc.xania.org/meta/`.

In outline:

- A **key** is a fingerprint of a disc or tape image, 32 hex characters, that comes out the same however
  the image was dumped or packaged. A client computes it from whatever it was given.
- A **record** is `meta/<key>.json`. It can point at a `parent` record, so an image's record usually
  chains up to one for the release and one for the title, and the client merges the chain. jsbeeb would
  use a record to show a title, instructions and links in its media window, to switch to the machine the
  software `requires`, and to map its `controls` onto touch and gamepads.
- A **symbol set** names the addresses of one program. It isn't found by key at all. Each set cuts its
  program into regions, and gives each region a few anchors, short runs of bytes that are always there
  when that code is in memory.
- **`meta/symbols/index.json`** lists every set's regions and anchors, without the names. jsbeeb fetches
  it the first time the debugger wants names, checks the anchors against memory each time the machine
  stops, and fetches a set's names only once its anchors match. So the names turn up wherever the code
  came from: a different dump, a crack, a compilation, a tape.

The rest of this is the detail a client or a curator needs. Why it's built this way, the prior art and
the exact thresholds are in [the design notes](media-registry-design-notes.md), and the evidence is in
[the findings](media-registry-findings.md). `tools/registry/` has a prototype of the fingerprint.

## Keys

A key is the first 128 bits of a SHA-256, as 32 lowercase hex characters, and all keys share one
namespace ([why](media-registry-design-notes.md#one-key-namespace)). An image can have a file key (the
SHA-256 of the file as downloaded), a disc key and a key per side, or a tape key. A zip has a file key,
and each image inside it is fingerprinted as if it had arrived alone. ROMs just use the file key.

A client tries the file key, then the disc or tape key, then the side keys in order, and uses the first
record it finds.

## Disc fingerprint

Computed from the disc as loaded, before any writes, one side at a time:

1. Get the side's bytes. For a sector image, that's its bytes in stored order, split into sides by the
   format's interleave (DSD and ADFS L alternate sides, and an `.adf` or `.adm` bigger than an M disc is
   an L). For a flux image, decode each track and keep the sectors with good header and data CRCs,
   whatever track their headers claim, ordered by the track they were read from, then header track, then
   sector ID. Where an ID repeats with different contents, keep each content once, in byte order. A
   40-track disc read in an 80-track drive is read from the even tracks only, decided per side
   ([how](media-registry-design-notes.md#reading-flux-captures)). FSD dumps are read the same way, with no
   pitch test ([how](media-registry-design-notes.md#fsd-dumps)).
2. Trim trailing 256-byte blocks that are one repeated fill byte, after padding a short last block with
   zeros. The fill byte is `&00` or `&E5`, or any byte on an ADFS disc (one whose first side has "Hugo" or
   "Nick" at `&201`) ([why](media-registry-design-notes.md#trimming)).
3. Hash. A side key is the SHA-256 of the trimmed side, cut to 128 bits. The disc key is the SHA-256 of
   the full side digests in order, cut the same way, leaving out trailing sides that trimmed to nothing
   (but always keeping the first).

So one dump of an unprotected disc gives the same key as an SSD, a padded SSD, an HFE or a zip of any of
them, and a DSD with a blank second side matches an SSD of its first. A side key is published only while
every image known to have that side belongs to one title. Once that stops being true its record becomes
`ambiguous` ([why](media-registry-design-notes.md#side-keys)).

The spec will ship with a reference implementation in JavaScript and C, and test vectors for each of those
cases.

## Tape fingerprint

A tape (UEF data chunks, or CSW at 1200 baud) is decoded to the blocks the MOS would read. Complete files,
and good blocks that aren't part of one, go into the key in tape order with their names, addresses and
data. Carrier, gaps, baud rate and anything outside MOS blocks don't
([details](media-registry-design-notes.md#tapes)).

## Records

A record is a JSON file named `<key>.json`, where the key is a hash or a title slug (short, lowercase,
hyphenated, and never 32 hex characters). Every record has `format` (1) and a `kind`:

| `kind`      | What it is                                                      | Named by     |
| ----------- | --------------------------------------------------------------- | ------------ |
| `title`     | a piece of software                                             | slug         |
| `version`   | one release of it                                               | slug         |
| `alias`     | one image or copy                                               | any hash key |
| `redirect`  | a slug merged into another: `{ "kind": "redirect", "to": ... }` | slug         |
| `ambiguous` | a shared side key: `{ "kind": "ambiguous", "candidates": ... }` | side key     |

A client treats `ambiguous` as no match, or offers the candidates.

Records chain through `parent`. Title, version, alias is the convention, but any depth works. A record's
metadata is its chain merged with [JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396) from the
title down, so the record nearest the image wins, and any record can set any field. Collections that a
lower record might change one entry of (`controls.actions`, `links`, `content`) are objects keyed by a
stable name rather than arrays ([why](media-registry-design-notes.md#record-chains)).

```json
{
  "format": 1,
  "kind": "title",
  "title": "Exile",
  "publisher": "Superior Software",
  "year": 1988,
  "requires": { "machines": ["B", "Master"] },
  "controls": {
    "actions": {
      "left": { "keys": ["Q"], "role": "left" },
      "thrust-up": { "keys": ["P"], "role": "up" }
    }
  },
  "links": { "catalogue": { "url": "https://...", "rel": "catalogue" } },
  "provenance": { "controls": { "source": "...", "method": "read from the instructions screen" } }
}
```

The first fields:

- `title`, `publisher`, `year`, `authors`, `aliases` (other names), and relations such as `contains` for
  compilations.
- `requires`: machine, second processor, ROMs, 40 or 80 tracks.
- `boot`, usually absent, meaning use the disc's boot option. It's only for discs that need `CHAIN""` or
  something else typed.
- `controls`: actions, each with its BBC keys, a label and optionally a `role` (`left`, `up`, `fire`...)
  that front ends turn into touch and gamepad controls. Host keys and layouts stay out of the record.
- `links` to pages elsewhere, and `content` shown inline, each `content` entry with a `source` and a
  `licence`.
- `provenance`: where each field's value came from, and how.
- On aliases, `note`, `tags` and `seenIn`: how this copy differs and where it was found.

## Symbol sets

A symbol set names the addresses of one program, or of programs that are always in memory together.
Records don't list sets, as a set is found only by its anchors
([why](media-registry-design-notes.md#finding-sets-by-their-anchors)). The sets live in `symbols/sets/`,
made by the importers in [the importers' doc](symbol-importers.md).

```json
{
  "format": 1,
  "title": "Exile v1.1: the game",
  "licence": "CC0-1.0",
  "source": "https://...",
  "madeFrom": ["<disc key A>"],
  "globals": { "player_x": "0x70" },
  "regions": {
    "main": {
      "start": "0x1100",
      "end": "0x5800",
      "minAnchors": 2,
      "anchors": [
        { "at": "0x1a2c", "bytes": "a9008d..." },
        { "at": "0x2e40", "bytes": "20eeff..." }
      ],
      "symbols": { "main_loop": "0x1a2c" }
    }
  }
}
```

### Fields

- `format` (1), and a `title` for the debugger to show.
- `licence`, the licence the names are used under, and `source`, where they came from. `notice` carries
  any text the licence asks copies to keep. `madeFrom` lists the keys of the images the set was made from,
  as a record of where it came from, and is never used to find the set.
- `regions`, each a range of memory from `start` up to but not including `end` (which can be `0x10000`),
  with its `anchors`, `minAnchors` (1 if absent) and `symbols`, the names for addresses in that range. An
  anchor is 4 to 8 bytes, all inside its region, and none of them in the I/O at `&FC00-&FEFF`. Addresses are
  lower-case hex with `0x` (`0x1a2c`), and an anchor's `bytes` lower-case hex pairs.
- Optionally a region's `scopes`, each a `start` and `end` inside the region and its own `symbols`: names
  for addresses outside it that apply to the code in that range, such as zero page that routines which
  never run together share.
- `globals`, names not tied to one region's code, such as zero page, buffers, data the program loads, or
  a table that replaces code once it has run.
- `system`, true only on a MOS's set listed in `symbols/mos-sets.json`.
- Optionally `home`, the author's own page for the work, and `nameLink`, a URL template for one name's
  place on the author's site. Its placeholders are `{name}`, `{addr}` (four upper-case hex digits) and
  `{place}`, which comes from `places`, an object from a name to a relative path and optional fragment.
  A name `places` doesn't give has no link from a template with `{place}`.

Every name is an address, so constants stay out. A name means one address throughout a set. It's in one
region or the globals or neither, and if not in a region it can also be in several scopes. No address has
two names in one region, the globals or one scope, and two scopes that overlap don't name the same address.
A scope names only addresses outside its region, and a system set's scopes are ignored. `home` and
`nameLink` are https, the template starts with its site (which no placeholder can change), and a place has
no `.` or `..` segments.

### Matching

A region matches while every one of its anchors matches memory and it has at least `minAnchors` of them.
Anchors are read from memory as the CPU sees it, so a sideways ROM's set matches in whatever slot it's in.
If two matching regions overlap, neither counts.

### Which name an address gets

A set's globals name only its own code's operands, except a system set's. A system set's globals (system
globals) name its own code's operands as any set's do, and also every other code's, last, while any of its
regions matches, but never an address inside a matching region of a non-system set.

For an operand of an instruction in one of a set's matching regions, the name comes from the scope the
instruction is in, then that set's matching regions, then its globals, then other sets' matching regions,
then system globals if its set isn't the system set. For an instruction outside every matching region, it
comes from matching regions, then system globals.

An address shown on its own, such as in the disassembly's address column, takes only its region's names if
it lies in a matching region. Otherwise it takes the name the scope holding the PC gives it, then the
global of the non-system set whose matching region holds the PC, if that set names it. Failing that, it
takes the global that one non-system set with a matching region names, no name if two or more such sets
name it differently, or a system global if none does.

jsbeeb's debugger shows the names from every set that matches, with each set's `home` and `source`, and
links each name to its place. Not built yet are dropping a set so it counts as not matching, offering a
choice where two sets' regions overlap, and breakpoints by name (which would stop only while the name's
region matches, or for a global, while any region of its set does).

### Curating a set

The pull request that adds a set carries the corpus check's report of every title each region matches
([the importers' doc](symbol-importers.md) has how to run it). A region whose other bytes are all or nearly
all identical there is the same code (a crack, a compilation) and the set rightly applies. One whose other
bytes differ is a collision, and needs another anchor. Two sets covering the same code become one shared
set, and overlays are separate regions over the same addresses, told apart by anchors where they differ
([how regions and anchors are chosen](media-registry-design-notes.md#symbols)). The build checks each set
on its own (schema, licence, anchors, `system`, names and places) but doesn't prove two sets apart.

ROMs get a set per version. No region covers the I/O at `&FC00-&FEFF`, the Master's and the Compact's MOS
are cut at `&E000` for HAZEL, and a sideways ROM is cut at `&9000` and `&B000` for the Master's ANDY and the
B+'s RAM ([why](media-registry-design-notes.md#roms)).

### The index

`npm run build-index` writes `symbols/index.json`, published as `meta/symbols/index.json`. It has `format`
(1) and, for every set, its `url` relative to the index, its `licence` and its `regions` without their
`symbols` or `scopes` ([how a client uses it](media-registry-design-notes.md#finding-sets-by-their-anchors)).

### Linked sets

These aren't built yet, and the build rejects a set with a `link`. A set stores names only when their
licence, or their author's recorded permission, allows it, but it can link names it can't store. `link`
holds the `url` of the names' file pinned to a commit, the file's `sha256` (64 lowercase hex characters),
its `format`, and `home`, the author's page. A set with only a link has no `symbols`, `globals` or
`source`, and its `licence` covers just its regions and anchors. A set has at most one `link`; any other
disassembly of the same code goes in its `links`, as in a record. The client asks before fetching, checks
the digest, gives each linked name to the region whose range holds it (or the globals), and drops any that
clash with a stored name ([details](media-registry-design-notes.md#linked-sets)).

## Stability and hosting

Records and sets can grow but don't break. `format` changes only for something that would break a format 1
reader, new fields can appear anywhere and clients ignore ones they don't know, fields never change meaning
or disappear, and a published key always resolves (a merged slug becomes a `redirect`, and a hash key just
gets a new parent).

The registry is this repository, published by CI from `main` to `https://bbc.xania.org/meta/` with CORS
open and a five-minute cache lifetime. Sets are under `symbols/`, and records will sit beside them.
Contributions are pull requests, and the build checks every file against the schema. A record lookup is
`GET <root>/<key>.json`, then the same for each `parent`, following a `redirect`'s `to` (at most a handful
of times).

## Licensing

The build enforces these ([why](media-registry-design-notes.md#licensing)):

- Our own data (keys, computed facts, relations) is CC0.
- Anything from elsewhere records its `source` and `licence`, and `content` or a symbol set without a
  licence fails the build.
- Linking is always fine. Inlining, with attribution, needs a licence that allows it, or the author's
  recorded permission. Anything of unknown licence, and any disc or tape image, is never included.
- Which keys a game uses is a fact; the text of its instructions is content.
- Sources under the GPL aren't used for sets, stored or linked, though a record or a set can link to them.
  Where an author has refused reuse, their work is a plain link at most.

## Filling it in

We'd start from our Stairway To Hell and HFE mirrors, MAME's software lists, TOSEC and the Bitshifters
manifest, and other catalogues after asking. Equal keys are aliases. Beyond that, an LLM proposes aliases,
controls and `requires` from clusters of similar images, and nothing it proposes is published until a
person has reviewed the pull request, with its provenance saying so
([how](media-registry-design-notes.md#finding-aliases)).

## Open questions

- Title slugs: our own, or MAME's short names.
- Whether 128 bits is the right key length.
- Whether tape data outside MOS blocks can be decoded consistently enough to include.
- Whether a few bytes of duplicator leftovers on a protected track (Philosophers Quest, perhaps Hopper)
  should split two copies, or whether an alias joining them is enough.
- Whether `beeb-meta-data` is a name other emulators will feel is theirs too.
- The `controls` schema, with Robert Smallshire and Beebium.
- Whether, and how, we can host screenshots.

Do let me know what you think, in [an issue here](https://github.com/mattgodbolt/beeb-meta-data/issues).
The proposal began in [jsbeeb#1179](https://github.com/mattgodbolt/jsbeeb/pull/1179).

---

This proposal was drafted by Claude (an LLM) with Matt.
