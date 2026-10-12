# Media registry: design notes

Why the [media registry proposal](media-registry-proposal.md) is the way it is, the exact rules behind its
keys, and the projects it borrows from. The numbers behind it are in [the findings](media-registry-findings.md).

## Goals

jsbeeb can load a disc from pretty much anywhere, but once it's loaded we know very little about it. Some
sources give a title and a publisher, and the Bitshifters manifest says which machine a demo needs; for
everything else we have a pile of bytes. Annotated source in the debugger
([#107](https://github.com/mattgodbolt/jsbeeb/issues/107), open since 2016), key remapping remembered per disc
([#748](https://github.com/mattgodbolt/jsbeeb/issues/748)) and an on-screen joystick for phones all need the
same first step, which is working out what we've just loaded.

So the registry should find the same record for the same disc whatever format it arrives in (SSD, DSD, ADFS,
an HFE flux capture, any of those in a zip), with ADFS mattering as much as DFS. Records are static JSON that
can be mirrored and can grow without a format bump, since licences, links and controls turn up long after a
record is written. A version, crack or repackaging inherits its title's instructions and keys and overrides
what differs. Every bit of third-party content says where it came from and under what terms. Records link to
disc images rather than holding them, and the registry isn't trying to replace the archives. And it should be
easy for other emulators to use too.

## Prior art

[MAME's software lists](https://github.com/mamedev/mame/tree/master/hash) (`bbcb_flop.xml` and friends, CC0)
give each title a short name, the CRC32 and SHA-1 of each image, and parent and clone relations. They hash
whole files, so the same software at two image lengths gets two hashes. [TOSEC](https://www.tosecdev.org/)
also hashes whole files and puts the identity in a naming convention, whose flags (`[a]` alternate, `[cr]`
cracked, `[h]` hacked, `[!]` verified) are a pretty good starting vocabulary for how copies differ.

The closest thing to what we want is the ZX Spectrum's ZXDB (and the ZXInfo API in front of it), with a
stable ID per title, lots of file hashes pointing at it with a note of where each came from, typed relations
like `duplicateOf` and `modificationOf`, and structured controls. RetroAchievements maps many labelled hashes
to one game too, and warns that you hash the image as loaded, not after the game has written to it. ScummVM
hashes named files inside a game rather than containers and keeps a table of renamed IDs. Homebrew's formula
API is a static JSON site built from git, where the client follows renames and aliases so the server needn't
do anything clever. js-dos has per-game mobile layouts, grids of on-screen keys plus a virtual joystick.

Closer to home, beebjit (Chris Evans) has a disc fingerprint: per side, a CRC32 of each track's good sectors
(data mark and data, in track order), then a CRC32 of those. Gaps and bad sectors don't count, so a sector
image and a flux capture agree if their sectors are in the same order, and jsbeeb's HFE mirror
(`tools/mirror-bbcdiscs.js` in jsbeeb) names its captures by these CRCs. Ours is the same idea with a longer
hash and a sector order that doesn't depend on how the disc was formatted. Clock Signal's Acorn analyser
(Thomas Harte) guesses the machine and how to boot from the content alone (the boot option, load addresses
that need a second processor, which I/O the code pokes), which is a good fallback when there's no record.
Robert Smallshire's [Beebium](https://github.com/rob-smallshire/beebium) has per-game key mapping files naming
the action each key performs (`"keyName": "Caps Lock", "action": "Rotate Left"`), and Robert is keen on an
emulator-agnostic way of describing game actions, so `controls` should be worked out with him. Rich
Talbot-Watkins' [Baron](https://github.com/waitingforvsync/baron) assembler dumps every resolved symbol with
`--symbols`; Rich was in the original #107 discussion. [bbcmicro.co.uk](https://bbcmicro.co.uk) already
launches jsbeeb from its game pages with a model and `KEY.` remaps in the URL, and its database has per-game
keys and a platform (see [the licensing rules](media-registry-proposal.md#licensing) before using any of it).

## One key namespace

If two kinds of key could collide, the hash is a bad hash, so there's no reason for a directory per kind. If we
ever change how a key is computed, the new keys just become more aliases and the old ones keep working.

The file hash is there because any tool can compute it without decoding a disc, and it lines up with the hash
lists other projects publish. beebjit's CRC is only 32 bits a side, a bit short to share a namespace with
thousands of other keys, so it's a plain field; our HFE mirror's manifest already maps those CRCs to discs.

## What the fingerprint is for

Its job is quite narrow: recognising the same dump of a disc whatever container it's in. Two discs that are
functionally the same but laid out differently (one `*COMPACT`ed, say) are a job for
[file-level matching](#finding-aliases). The findings bear this out, as archive SSDs are mostly re-mastered
copies, so almost no capture shares a key with one, while shared files link 1,052 discs across sources. It
works from sector bytes rather than a disc model and knows next to nothing about filesystems, which should make
it pretty easy for any emulator to implement.

## Trimming

Baron truncates its SSDs after the last used sector and plenty of tools pad them to 200K, so trimming is what
lets those agree. Only fill is dropped, so a reused disc with old data past its last file keeps it.

On DFS discs `&E5` (left by a format) and `&00` (padding) are almost all the corpus shows, and the few other
runs could as easily be the end of a file. ADFS formatters left `&5A`, `&47`, `&F6` and more behind, and a blank
second side of one of those would stop a capture ever matching an image of its first side, so on ADFS any
repeated byte counts. Looking for the root directory's "Hugo" or "Nick" is the one bit of filesystem knowledge
the fingerprint needs. A DFS disc with those bytes at `&201`, or an ADFS disc re-catalogued as DFS, gets
trimmed harder than it should, which only costs a key that differs from other copies. The
[findings](media-registry-findings.md#trailing-fill) have the counts.

## Reading flux captures

The rules, as `tools/registry/fingerprint.js` implements them. Only sectors with good header and data CRCs
count, for the pitch test as for the key.

If nothing past physical track 50 holds data, every track is read. Otherwise the side is 40-track if at least
four even tracks other than track 0 have a sector whose header gives half their physical track number, and
more even tracks do that than give their own; or, failing that, if at least four even tracks hold data and
fewer than a tenth as many odd tracks hold a sector that isn't a copy of an even neighbour's. An odd track
that read nothing counts as a copy, so an 80-track capture whose odd tracks all failed is taken as 40-track
(a bad dump anyway).

Sectors are ordered by the track read from, then header track, then header sector ID. Where all three repeat,
identical copies count once and different ones are each kept once in ascending byte order, a sector sorting
before a longer one it is the start of. The result is trimmed as 256-byte blocks whatever the sector sizes.

A 40-track disc in an 80-track drive has its data on the even tracks, with the odd ones empty or ghosts of
their neighbours. Neither sign works alone, since protected discs renumber their tracks and some discs
legitimately repeat one. jsbeeb's `sniffSurfaceLayout` does something like the header test, but once per disc,
and a flippy disc can have a different pitch on each side. Weak sectors read differently on every capture, so
bad CRCs are dropped.

Sectors whose header claims another track are kept. An earlier draft dropped them and got it badly wrong:
Superior's protection renumbers every track after track 0, so the rule threw away the whole game, and Exile
and Repton Infinity, whose boot tracks are identical, got the same key. On an unprotected disc the headers
match anyway, so the order and bytes are the same as an SSD's. The price is that a capture of a protected disc
no longer matches an SSD made from it, which hardly ever happened anyway, as the SSDs are mostly re-mastered.

Keeping only the first of a repeated sector ID made the key depend on read order, which is how a capture of
The Empire Strikes Back and the FSD dump behind its reconstruction got different keys. On some protected discs
the copies are the protection, so keeping one, or none, would let discs that differ only there share a key.
Keeping every different copy costs at worst an alias, and a wrong match is worse than a missed one. Counting
copies doesn't work either, as that capture and that dump hold them different numbers of times.

The data is concatenated without positions, so a missing sector part way through shifts everything after it
and the capture gets a key of its own. That's a bad dump, handled as an alias like any other variant. The HFE
mirror names its files by file hash rather than fingerprint, because it needs one name per file.

## FSD dumps

An FSD records each sector's header, data and read status, so it can be fingerprinted without rebuilding a
flux image. Every track in the dump is read, with no pitch test, and sectors are ordered as a flux capture's
are, with the dumped track in place of the physical one. A sector counts when it was read cleanly, or when its
data had a CRC error but the bytes it overran hold a good CRC after a shorter power-of-two length (the dump
read past the sector's real end), and then only that length counts. A track the dump could only read headers
from contributes nothing, and since some captures hold `&E5` there and nothing in the dump says so, the key is
provisional: recorded, but never used to merge the dump with other images.

## Side keys

Some side digests are shared by lots of unrelated discs (every blank formatted side looks the same), so a
match alone proves nothing. Publishing a side key only while it's unambiguous, and turning it into an
`ambiguous` record when that changes, means a published key always resolves and never to the wrong title. A
formatted but empty second side still has a catalogue, so a DSD with one gets a disc key of its own and finds
the SSD's record through the side key.

## Tapes

Carrier, gaps, baud rate and container chunking vary between captures of the same tape, so the key is over
the blocks the MOS would read. The rule, as `tools/registry/tape.js` implements it:

1. Decode the tape to bytes: UEF data chunks (`&0100` and `&0104`), or CSW pulses at 1200 baud.
2. Find MOS blocks: `&2A`, a name of up to ten characters and a zero, load and execution addresses, block
   number, length, flags and four spare bytes, a CRC-16 of those, then the data and its CRC.
3. Consecutive blocks with the same name, numbered up from 0 to one with bit 7 of its flags set, make a
   complete file if none has a bad CRC. A block with the same name and header as the last block of the most
   recent file may be a retry, even after it closed the file. A good copy replaces a bad held copy, a bad or
   identical copy of a good one is skipped, and a good one with different data is a different block.
4. Hash records in tape order with SHA-256 and cut to 128 bits. A complete file gives `&46`, its name and a
   zero, its load and execution addresses and length (32-bit little-endian), then its data. A good block
   outside a complete file gives `&42`, its name and a zero, its load and execution addresses, its block
   number (16-bit) and flags, its length (32-bit), then its data. A record identical to the one before it is
   left out.

The loose-block records are how protected tapes, which number their blocks in ways the MOS wouldn't accept,
still get their content into the key.

## Record chains

Instructions and keys belong to a title, and a version or a copy overrides only what differs, such as the
machine it needs. A chain merged with JSON Merge Patch does that with no special cases, and there are libraries
for it in pretty much every language. Merge Patch replaces arrays wholesale, which is why collections are
objects keyed by a stable name, so a version can change one action or add one link without repeating the
rest. Redirects are only for slugs, because a hash key is already an alias with a parent. Symbol sets aren't
part of the chain at all ([why](#finding-sets-by-their-anchors)).

## Symbols

BBC games rewrite their own memory all the time. Code is decrypted and relocated as it loads, variables sit
amongst the code, and the emulator has no idea when loading has finished, so a symbol set can't just be pinned
to a disc, nor checked by hashing big ranges of memory. Anchors are cheap to check (a handful of bytes each
time the machine stops), and before the code has arrived they simply don't match, so we never need to know
when loading is done. Because they check the code rather than the disc it came from, they're also how a set
is [found](#finding-sets-by-their-anchors).

The anchor rules are in [the importers' doc](symbol-importers.md#anchors). They came from trying it on
Repton 2, then on Superior's PIPELINE, rebuilt byte for byte from source, which gave the format its second
test. A store that can reach an anchor would make it fail while the game runs, and runs of `NOP`s are where
cheats poke. Padding and bytes left over from whatever was in memory when a file was saved aren't the program,
but a byte-for-byte rebuild has to emit them too, so the source says which they are rather than a trace. Runs
that many programs share (an entry point opening with `*FX4,1`, a BASIC program's first line) make weak
anchors, which the corpus check finds. Choosing anchors turned out to be mostly automatic; what stays manual
is cutting regions and spotting which parts of a listing aren't the program. A big file makes a poor single
region, since one build difference is only caught if an anchor happens to sit on it, hence smaller regions
with `minAnchors`.

PIPELINE's disc, according to its project, holds several programs that take turns in the same memory: three
loader stubs at `&0900` that differ in 6 of their `&D9` bytes, the game, a level designer and a graphics
editor, plus a data file the game loads over its own load image. The game swaps `&0D00-&1CFF` with the screen
while it loads that file, and its start-up code becomes a table of the level's objects once it has run. Most
of what follows is about programs like that.

### Format

A set is in our own format rather than an assembler's, because the debugger needs much less than any
assembler's dump and those dumps change. Baron's puts labels and constants alike in one object per source
file and doesn't say which section a label is in, so there's no range to tie it to. An importer per assembler
sorts that out once ([how](symbol-importers.md)). Names are addresses only, since a constant shown as an
address is the one thing a debugger would get wrong. Each program, with what's always loaded with it, is its
own set.

A set carries its own `title`, `licence` and `source` because no record lists it. `madeFrom` is for whoever
checks the set later and is never used to find it.

A region's names win over its set's globals at the same address because that's where code turns into data:
when PIPELINE's start-up code is overwritten, its region stops matching and the global naming the object table
shows instead.

Globals name only their own set's code because a loader often stays where it was after jumping to what it
loaded. PIPELINE's stub that loads the graphics editor stays intact while the editor runs, and names `&70` and
`&72` differently from it. Going by the instruction gives each program's code its own names whichever is
running. Going by the PC instead (or a return address on the stack when the PC is in a ROM) would name all the
code on screen after whatever holds the PC, and a stack scan can still meet a loader's return address long
after the loader has finished. Code outside every matching region gets only the MOS's globals, as whatever it
does with zero page, it isn't any set's program doing it.

An address shown on its own has no instruction to go by, so there the PC settles clashes between sets'
globals (the [proposal](media-registry-proposal.md#symbol-sets) has the rule). That's for BASIC II, which
stays paged in under most programs and names much of zero page, so every pairing of a program with BASIC would
otherwise clash. It isn't trusted further than that, for the reasons above.

Operands are named by what's in memory now, which has one known limit. PIPELINE's `load_mission` writes an
`RTI` to the MOS's NMI routine at `&0D00` after swapping the game out, but whenever the game is in place its
own region names `&0D00`, so the instruction reads `STA clip_sprite_left_cells`. Fixing that would mean knowing
when an instruction runs, and we don't trace.

Every program uses the MOS's addresses as well as its own, and under the rule above a game's `STA &020E`
wouldn't read `WRCHV`. So a MOS's set is a system set, lending its globals to all other code after everything
else, and only a MOS's can be one (`symbols/mos-sets.json` lists them, and only one MOS version's set should
match at a time). That names OS addresses in any program, including a game no set covers. A game that reuses
OS workspace for its own variables gets the OS's names unless its set names them, and even a wrong name says
what the address was. System globals never name an address inside a matching region of a non-system set,
since there it's that program's code or data; PIPELINE's level designer runs over the MOS's envelope storage
at `&08C0`, and its game over the MOS's buffers from `&0A00`.

Sets live in the registry rather than at a link elsewhere, so the build's checks and the index can't go stale
when someone else's file changes.

### Where to cut regions

Every anchor in a region has to match. Tolerating one failure would let near-identical overlays both match
(the PIPELINE stubs share most of their candidate anchors), whereas a failed anchor over code that's still
there just shows plain addresses for a while, which is the safe direction. So the work is in cutting regions
where memory changes, using what the build already says. The code gives the bounds of its copies, swaps and
loads (a block copy's inline arguments, an `OSFILE` parameter block), and the curator picks the ones that move
a program. Cut at their bounds, those cover whole regions and don't rule out anchors in them, while any other
store still does. Cutting PIPELINE's game at `&0D00` and `&1D00`, the bounds of its swap, means only the
swapped part loses its names while the data file loads. Code that's overwritten once it has run is a region of
its own, anchored on the bytes that get overwritten, so its names go when it does.

Writes no static analysis sees (filing system workspace, copies through a computed pointer) can still land on
an anchor, and the region loses its names until the bytes come back, which is fine during a disc load. Someone
who notices can move the anchor or tell the chooser to avoid a range. We don't record runs of the game to find
these: anyone with the source or a listing should be able to make a set without playing every part of the
game, and a recorded run only covers what was played. Code parked where it can't run (the swapped part of the
game in screen memory) isn't labelled, as that would need a region with an offset, which isn't worth a field.

Overlays are told apart by an anchor on a byte where they differ, and one run of the chooser picks all of a
title's anchors together, checking each region's against the others' bytes. It notes when a region can't get
such an anchor. Merging names that happen to agree isn't worth its rules.

Sets made separately are told apart by the [corpus check](symbol-importers.md#the-checks), whose report the
pull request that adds a set carries. A region that's all or nearly all identical in another title is the same
code (a crack, a compilation, a re-release), and the set rightly applies there; anchors that agree over a
region whose other bytes differ are a collision, and the region needs another anchor. A person reading the
report makes that call, so it lists every title a region matches rather than failing on any match. On the
Stairway To Hell discs, PIPELINE's three big programs show up only through a crack, which is the same code
under another key. Proving two sets apart in the build instead would need every pair of overlapping regions
to anchor a common address where they differ, so extra anchors on every earlier set a new one overlaps, and
that cost grows with the registry, whereas the corpus check's doesn't. Across the corpus, the 2,228 matches
between titles were all in files at least 10% alike, nearly all 90% or more, and all the same code or data.
Its limit is the corpus's. Files sit at their load addresses, so code that's relocated or decrypted as it
loads, or that no catalogued file holds, isn't looked at, and an empty report says only that nothing at those
addresses matched. Two sets that slip past it fall to the debugger, which shows neither where regions of two
sets match at the same address.

The list of MOS sets is kept by hand, since no address range tells a MOS from other ROMs (the Atom's BASIC,
floating-point and DOS ROMs sit at `&C000-&EFFF`, below its kernel), and a change to it should need a
maintainer's review, as the debugger's rule wouldn't catch a set wrongly on it.

A breakpoint set by name (not in jsbeeb yet) should stop only if the name applies when it's hit, so a
breakpoint on the game's main loop doesn't stop when the level designer runs at that address. The price is
that a write that breaks an anchor quietly disarms it, and a breakpoint by address is there for anyone who'd
rather have that. A breakpoint on a global stops while any region of its set matches, so it can stop for
another program's use of that address, which is the safer mistake, as a program's variables are also written
by code no set covers (the filing system filling a buffer).

### Finding sets by their anchors

Records don't list symbol sets, because an image's key is the wrong thing to find them by. A key names one
dump of one disc, while the code a set names turns up under many keys. PIPELINE's level designer and Mission
Generator save to the game disc, so a used copy has a new key, and the same code is in a crack that left it
where it was, a compilation, a cheat disc, or a tape that loads it at the same address. Anchors find a set by
one path for all of those. Where code has moved, as it often has on a tape release, a set made for that copy
is found the same way.

Looking up a catalogued file's hash wouldn't do as well. On PIPELINE the catalogued files are only the loader
stubs, which differ between the copies we have, and the code that matters is in sectors the catalogue doesn't
cover. Anchors cope with both. A save to a used copy goes after the last catalogued file, just short of the
game's code, so the first saved level fits and a second lands on the game's first sectors; the regions
anchored there stop matching, which is right, and the rest still match. Stairway To Hell's PIPELINE is a crack
whose game and graphics editor are byte for byte the originals, and the level designer's three changed bytes
are mid-routine, away from any anchor, so all three sets match.

The build publishes every set's location, licence and regions with their anchors, without the names, in
`symbols/index.json`. The debugger fetches it the first time it wants names, checks every indexed region each
time the machine stops, and fetches only the sets that match. If the index or a set can't be fetched, it shows
plain addresses and tries again later, waiting longer after each failure (doubling from 5 seconds up to 5
minutes) rather than retrying at every stop. Most regions fail on the first byte of their first anchor, so
even a few thousand cost little next to drawing the view. A set's entry is a few hundred bytes, so hundreds of
sets come to a few hundred KB. If that gets too big, the index can be split into one file per 256-byte page,
but names need more than the pages on screen (the pages operands point into, the MOS's, every set that might
name an address shown on its own), so not before then.

A set that matches is shown, not offered. Matching anchors only show that the anchored bytes are the same, but
in the corpus a region that matches another title is that title's copy of the same code or data
([below](#code-that-turns-up-elsewhere)), so its names fit. Where two versions differ between the anchors some
names can be off, so the debugger says which set the names come from.

### Code that turns up elsewhere

[The findings](media-registry-findings.md#anchors-across-titles) placed every file on the Stairway To Hell
discs at its load address and looked for anchor-sized runs at the same address in other titles. Where they
turn up it's the same code or data, nearly always with 90% or more of the file identical: the game in a
compilation, on a cheat disc or in a re-release; an engine games share, such as the Scott Adams, Level 9, GAC
and Epic adventure interpreters; or a publisher's loader, such as Superior's at `&1900` in Baron, Barbarian II
and 3D Dotty. Names made for that code fit it wherever it turns up.

The risk is a set that names game-specific things in a region anchored only on shared code. A Level 9 game's
set that took in the interpreter would label every Level 9 game's data with that one game's names. The corpus
check shows it as a collision, with the interpreter's anchors matching every Level 9 game and the rest of the
region not. Shared code becomes a set of its own, one Level 9 interpreter set for every Level 9 game, and each
game's set keeps to its database, in a region anchored on data the interpreter never writes (text, vocabulary
and action tables, not where the objects are). The interpreter's stores go through pointers, so a person, or a
reader for the game's format, picks those parts. If another set already covers the same code, the two become
one shared set; it has one licence, so a second contributor's names join it only under a licence that
combines with the first's.

### ROMs

Nothing writes to a ROM, so the store rule and the cuts at copies don't apply, and anchors can sit anywhere
but `&FC00-&FEFF`. Each version of a MOS, BASIC, DFS and ADFS gets its own set (so far there are MOS 1.20 and
BASIC II), told apart by anchors where the versions' images differ. The MOS, whichever sideways ROM is paged in
and the game in RAM all match at once without conflict. A language's set matches whenever it's paged in, which
on a B is BASIC through most games, so if it names its workspace as globals, a game's own names for those
addresses are left bare in the memory view; instructions aren't affected.

Anchors are read from memory as the CPU sees it, so a sideways ROM's set matches in whatever slot the ROM is
in, with no field saying which, and shadow RAM works the same way. Showing a bank that isn't paged in would be
a change to jsbeeb's disassembly view, not to the format.

A ROM address isn't always ROM, so a ROM's regions are cut where the hardware can put something over it.
`&FC00-&FEFF` is I/O on the BBC Micro, the Master, the Compact and the Electron, so no region of their ROMs
covers it, and no anchor sits there even in an image that has bytes for it, since dumps of the same ROM differ
there (jsbeeb's and beebjit's Master MOS 3.20 differ there and nowhere else). The Atom's I/O is at
`&B000-&BFFF`, where it has no ROM, so its kernel's regions run to `&FFFF`, though its anchors stay out of
`&FC00-&FEFF` so the build's check is the same for every set. The Master pages HAZEL, its 8K of filing system
RAM, over `&C000-&DFFF` (bit Y of ACCCON), and ANDY, 4K of RAM, over `&8000-&8FFF` (bit 7 of ROMSEL), the
bounds jsbeeb's Master memory map uses. The B+ pages 12K over `&8000-&AFFF` by bit 7 of ROMSEL, though jsbeeb
doesn't emulate the B+, and the Compact pages its memory as the Master does. So the Master's and the Compact's
MOS are cut into `&C000-&DFFF`, `&E000-&FBFF` and `&FF00-&FFFF`, and a sideways ROM's set at `&9000` and
`&B000`, so the rest keeps its names while that RAM is in.

### Linked sets

Linked sets aren't built yet (the build rejects a set with a `link`), but the proposal describes them, and
this is why. Most disassemblies state no licence, so a set can't store their names, but it can point at them.
A set with only a link keeps just what's ours, its regions and anchors (which come from the code's own bytes),
and where the names live. A MOS set could store the documented interface and system globals and link a fuller
disassembly, with stored names winning where the two disagree.

The debugger asks before fetching, because it's someone else's work from someone else's site, and remembers
the answer for that author's `home` and host together. Neither the build nor the client follows a redirect to
another host, so agreeing once never sends a request to a host the user wasn't shown. The link is pinned to a
commit, never a branch, so names and anchors stay in step, and carries the file's `sha256`, since a URL alone
can't prove the file won't change.

That limits what can be linked. The host has to allow cross-site fetches and serve a pinned version, which
GitHub's raw files at a commit do and GitHub Pages and most personal sites don't. The file has to carry
addresses (a listing, a label file, an assembler's report), since jsbeeb won't assemble anything, and hold only
the set's program, since the client gives a region the names in its range and makes the rest globals. Data
overlaid at run time then goes with the wrong region: PIPELINE's level being edited fills the level designer's
start-up code, and IO is loaded over H.GAME's loader. A set like that needs storing, with regions and globals
assigned by hand, which needs a licence or permission. Each format also needs a converter in jsbeeb, so only a
few common ones would be accepted. Asking authors for a licence still helps, since a stored set needs no
converter and survives the source moving or vanishing.

## Licensing

CC0 for our own data lets every emulator take it, as MAME does with its software lists. Anchors are a few
bytes of the program, but they identify it rather than reproduce it, so we treat them as facts about it, like
a hash, and they're CC0 with the rest of our data whatever a set's `licence` says about its names.

Disassemblies need care. Several published BBC disassemblies have no licence, and some say outright that no
reuse is permitted. Without a licence a set could only link their names ([linked sets](#linked-sets)), and
where reuse is refused they're a plain link at most, until their authors tell us otherwise. GPL sources aren't
used for sets, stored or linked (the build rejects a GPL `licence`), though a record or set can link to them,
because the GPL's terms on what's made from a source are more trouble than a registry other emulators take
should carry. Permission to inline is recorded in the entry (a link to where it was given, or when). MAME's
software lists are CC0 and can be used directly, TOSEC's names and hashes are factual data used with credit,
and any database without a stated licence is asked first and linked to meanwhile. Whether we mirror a disc
image is a separate decision about that image.

Acorn's documented interface (the MOS's entry points, vectors and workspace, as documented for programmers) is
a published interface rather than anyone's disassembly, so sets of it can be ours from the start. We treat
Acorn's ROMs and the sources Acorn has published (OS 1.20, BASIC 4 and DNFS 3.00) as effectively in the public
domain, so those can be where a stored set's names come from. So can the
[Atom kernel and BASIC sources](https://theoddys.com/acorn/acorn_system_computers/atom/atom.html), whose site
[allows](https://theoddys.com/acorn/index.html) any use that isn't for commercial gain; that permission goes in
the set's `licence`. Annotated disassemblies or reconstructed sources cover every BBC MOS from 0.10 to 2.00,
the Master's 3.20 and 3.50, the Compact's 5.10, the Electron's 1.00, BASIC I to 4r32 and HiBASIC, the DFSes,
ADFS and the Atom's ROMs, but almost all state no licence, and their authors are being asked for one. py8dis's
[`acorn.py`](https://github.com/ZornsLemma/py8dis/blob/master/py8dis/acorn.py), under MIT, names the OS vectors
at `&0200-&0235`, the entry points at `&FFB9-&FFF7`, some of zero page, and the FRED, JIM and SHEILA registers
of the B, the Electron and the Master. Our MOS sets start from that and Acorn's documentation: CC0 where they
come from the documentation alone, MIT with its `notice` where they take from `acorn.py`, since MIT asks for
it in every copy and sets are fetched one at a time. The BBC Micro's MOS sets have since been remade from TobyLobster's
reassemblies, under the CC BY-NC licence he gave them.

Which keys a game uses is a fact, so `controls` records it along with where it came from, but the text of the
instructions, like a screenshot, has a copyright of its own.

## Finding aliases

Most of the work of filling the registry is mechanical, with an LLM helping on the calls that need judgement,
and nothing is published until a person has looked at it. Clustering by shared files is what links archives,
since the keys mostly don't. Files are read the way the filesystem addresses them, not from the fingerprint's
byte stream, which on a protected disc holds extra sectors. A crack differs by a few bytes in a loader, a menu
disc is the game's files plus some extras, 40- and 80-track copies share every file, and a tape and a disc of
the same game share the main code. The pipeline:

1. Collect each image's source, keys and decoded file list (names, addresses, lengths, a hash per file).
2. Group equal keys as aliases.
3. Cluster images whose shared files make up at least half of each, leaving out files under 512 bytes or of
   one repeated byte (unrelated discs share those) and discs that catalogue less than 8K in the rest (often a
   protected disc's loader alone). When shared files make up half of only the smaller image, the bigger one
   `contains` it.
4. Judge each cluster with an LLM working through tools (a byte diff, the disassembler, a BASIC detokeniser,
   headless jsbeeb reading the title screen), putting each difference into one of: same dump, bad dump,
   remastered, disc written to, protection removed, trainer or cheat, menu or extras added, compilation,
   another disc of the same set, 40- or 80-track packaging, compatibility fix, publisher revision, port, or
   different software. Claims have to be checkable by a tool ("differs only in `$.LOADER`, at these bytes")
   so the pipeline can check them again.
5. Review: each cluster becomes a pull request of alias records with its evidence and a confidence level, and
   the records' provenance says they were proposed by automated analysis and then reviewed.

The findings include a pilot of this over the whole corpus, with two independent LLM judges on a sample of
pairs. The same pass can read keys off instruction screens and find which machines each variant reaches a
title screen on, as the findings' boot survey does for the whole corpus. What that gives for `requires` are
candidates for a person to confirm, because an Electron release or a gap in jsbeeb looks just like a machine
requirement.

---

These notes were drafted by Claude (an LLM) with Matt. The survey of other projects was done by reading their
code and documentation.
