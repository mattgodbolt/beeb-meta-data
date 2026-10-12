# Media registry: first findings from the archive

These are the results of running a prototype of the fingerprint from the [media registry
proposal](media-registry-proposal.md) over every disc image we could get hold of, fetched on 24 September 2026, and
[the design notes](media-registry-design-notes.md) say how they shaped the design. The tools are in `tools/registry/`
(its README lists them). Our mirrors are live, so a later fetch may not give exactly these numbers; MAME's list is
pinned to a commit. Only aggregate numbers from the bbcmicro.co.uk images appear here.

## What this changes in the design

- The flux path keeps sectors whose headers claim another track, orders them by the track they were read from, and
  decides 40 or 80 tracks from three signs rather than one.
- Trailing fill on DFS discs is only `&00` and `&E5`. On ADFS discs it's any repeated byte, and ADFS images are laid out
  by size, whatever their extension.
- A track that repeats a sector ID with different contents keeps each content once, in byte order.
- FSD sector dumps are a fingerprint input, with provisional keys where a track couldn't be read.
- Tapes have a key of their own, from the blocks the MOS would read.
- File-level matching is what links the archives. It reads catalogues by sector address, ignores discs that catalogue
  only a loader, and finds compilations as `contains` relations.
- The judging categories gained another disc of the same set, 40- or 80-track packaging, and a direction for
  `contains`.
- Anchors avoid `NOP` runs and come in smaller regions with a minimum count.
- Symbol sets are matched by their anchors, and an image's key plays no part. A set's pull request carries a corpus
  check (`tools/symbols/corpus-check.js`) for code other titles share; a person reading its report, and not the build,
  tells sets apart.
- Still open is whether duplicator leftovers should split copies.

## What went in

| Source                       | Images | What they are                                               |
| ---------------------------- | -----: | ----------------------------------------------------------- |
| Our HFE mirror               |  1,985 | flux captures of original discs, many of them protected     |
| Our Stairway To Hell mirror  |  1,625 | SSDs and DSDs, from 1,608 zips                              |
| The bbcmicro.co.uk image zip |  4,150 | SSDs, DSDs and a couple of ADLs, analysed privately         |
| MAME's `bbcb_flop.xml`       |    326 | hashes only, compared against the others' whole-file SHA-1s |
| Matt's NAS: FSD dumps        |    427 | the sector dumps many of the HFE reconstructions came from  |
| Matt's NAS: tapes            |    474 | 209 UEFs and 265 CSWs                                       |
| Matt's NAS: ADFS images      |     29 | mostly copies of a few discs from old emulator trees        |
| scarybeasts' Compact archive |     38 | flux captures of commercial Master Compact ADFS discs       |

The main corpus is the first three, 7,760 disc images. The Compact archive is a [public Google Drive
folder](https://drive.google.com/drive/folders/1MhKFfdWMIXzxB4awgijmbESvK7Ghl9q6), fetched into
`.registry-corpus/adfs-hfe/`.

As a check that the sector and flux paths agree, every one of the 5,775 sector images was also loaded by jsbeeb,
decoded through the flux path and trimmed, and all of them gave the same bytes both ways.

## Matches across sources

| Disc keys found in          | Count |
| --------------------------- | ----: |
| bbcmicro.co.uk and STH      |    57 |
| bbcmicro.co.uk and HFE      |     4 |
| bbcmicro.co.uk, HFE and STH |     2 |
| HFE and STH                 |     1 |

The 7,696 distinct files collapse to 7,364 disc keys, mostly because the HFE mirror holds the same disc more than once
(its 1,985 files are 1,660 distinct discs), and captures and reconstructions of one disc agree. But only 64 keys turn
up in more than one source.

The archive images are mostly re-mastered copies, with the files written out again by some tool, rather than dumps of
the original discs. Of the 450 captures that share at least half their files (counting files of 512 bytes or more)
with a Stairway To Hell SSD, 398 have those files at different sectors. Return of the Jedi is typical: an extra
`$.LOAD`, a different `$.!BOOT` at sector 2 rather than 143, the title rewritten as `RETURNOFJEDI` and cycle number 6
rather than 39. That's the `*COMPACT` case, and no disc key should try to match it.

Even exact file matches rarely share a key. 17 captures have the same DFS files as an archive image (19 pairs, as some
match more than one). Twelve of the pairs have the files moved, and the other seven differ in leftovers: old data in
free space on four Cheat It Again Joe pairs, and catalogue and leftover sectors on three of The Hobbit. A key over the
set of files instead would give 73 cross-source matches rather than 64, as images sharing most files usually differ in
a small one such as `!BOOT`. So linking the archives is a similarity job, which is [below](#families-from-shared-files).

## Protection and the track rule

The first draft of the flux path kept only sectors whose header named the track they were read from. On side 0 of the
HFE captures, 1,542 had no wrong-track sectors, 98 had 1 to 10, 114 had 11 to 100 and 231 had more than that. The big
ones are protection. An Exile capture, from an 80-track drive:

```
physical  0: track 0,   sectors 0..9
physical  4: track 200, sectors 100..109
physical 10: track 197, sectors 103..112
physical 20: track 192, sectors 108..117
physical 40: track 182, sectors 118..127
```

Superior renumbers every track after track 0, and the game lives there. The rule kept only track 0, a stub catalogue
and loader that Exile and Repton Infinity share byte for byte, so the two games shared a key.

The fingerprint now keeps every sector with good CRCs, ordered by the track it was read from. Over the whole HFE
mirror, against the first draft, the 1,542 clean captures keep their keys. Keys shared by captures whose titles have no
word in common drop from 9 to 6, and all six are one title spelled two ways (E-Type and E Type, Fire Track and
Firetrack, Q-Master and Q Master, ViewStore and View Store, The Dam Busters and Dambusters, Cheat It Again Joe and CIAJ
Vol 1). 16 groups the first draft merged are split, nearly all copies that differ in tens to hundreds of sectors on the
protected tracks. Two splits are near-identical pairs, Hopper v1 (three bytes) and a Philosophers Quest pair (four
sectors), each a capture against a reconstruction from an FSD dump; the registry links those with an alias. A third
was the fingerprint's own fault, and is fixed ([below](#sector-dumps)). `split-diffs.js` prints the detail.

## Which track is which

Keeping renumbered sectors broke the test for a 40-track disc read in an 80-track drive (do even tracks' headers give
half their track number?), so the Exile captures were judged 80-track, their ghost odd tracks went into the key, and
they stopped matching their reconstructions. A ghost test alone isn't safe either, as a disc can legitimately repeat a
track.

The rule now runs in order. If nothing past physical track 50 holds data, every track that does is real. Otherwise
the side is 40-track if at least four even tracks carry headers for half their number, and more of them than carry
their own. Failing that, it's 40-track if at least four even tracks hold data and fewer than a tenth as many odd tracks
hold anything but ghosts. Against the header test alone, six captures change key: four Superior discs (Exile v1 and v2
now match their reconstructions, plus two Repton Infinity captures), and Replica 3 and a Genie Utilities
reconstruction, 80-track discs with leftovers of a 40-track format past their data. Nothing that agreed before is
split.

## Trailing fill

Across 5,819 sides of DFS images, the trimmed sectors were `&E5` on 3,978 sides and `&00` on 165. Any other repeated
byte turned up on 6 sides in total, and a run of spaces or zeros could just as easily be real data, so DFS trimming
stays limited to `&00` and `&E5`.

ADFS is different. Of 62 ADFS sides from the corpus and Matt's NAS (`fill-survey.js --adfs`), 31 end in runs of `&5A`,
`&47` or `&6C`, but those come from emulator trees. The Master Compact captures settle it: of their 48 sides, 25 end in
`&5A`, 8 in `&47`, 8 in `&E5` and one each in `&1A` and `&F6`, and seven second sides are nothing but `&5A` or `&F6`.
Under the DFS rule those blank sides would stop a capture ever matching an image of its first side. So on an ADFS disc
(marked by "Hugo" or "Nick" at `&201`), any repeated byte counts as fill.

## Side keys

Only 64 images are double-sided, and 11 of their side keys also turn up on another disc. Ten of those are the same
title; the eleventh is two unrelated discs, which is what the `ambiguous` record for shared side keys is for.

## MAME

32 of the 326 images in MAME's BBC disc list match a corpus image by SHA-1 (23 Stairway To Hell, 10 bbcmicro.co.uk, one
in both). MAME's list says it came from Stairway To Hell, but most of it no longer matches what the archive holds. Its
value to the registry is its short names and parent/clone structure.

## Families from shared files

`cluster.js` puts two discs in one family when the files they share, by content, make up at least half of each by size.
When they make up half of only the smaller one, the bigger one contains it, which is how compilations show up. Discs
that catalogue less than 8K take no part, as many protected discs catalogue nothing but a shared boot loader (one
1,280-byte `!BOOT` linked seven or eight unrelated educational titles). Files are read by each sector's header, the way
DFS addresses them, and a file over unreadable sectors doesn't count.

5,341 of the 7,364 disc keys catalogue enough to take part. They form 515 families of more than one disc, 384 of them
across sources, joining 1,052 discs where the keys joined 64 groups. The 690 `contains` relations we looked at really
are compilations (Bananaman on a Blue Ribbon disc, Airlift on the Superior Collection).

Against the HFE mirror's own labels, false links are few: of 429 pairs of labelled captures in one family, 423 share a
title word, and of the six that don't, four are one title spelled differently. Recall is weaker. Of 288 same-label
pairs, 135 end up together; of the 153 that don't, 88 share no file at all (probably different builds), and 10 are
joined by `contains` instead. The threshold trades one against the other:

| Share needed | Discs in cross-source families | Same-label pairs together | Pairs with unrelated titles |
| -----------: | -----------------------------: | ------------------------: | --------------------------: |
|          0.3 |                          1,292 |                       151 |                          27 |
|          0.4 |                          1,176 |                       147 |                           8 |
|          0.5 |                          1,052 |                       135 |                           6 |
|          0.6 |                            922 |                       124 |                           4 |

Telling versions of a title from different software is left to judging.

## Judging the differences

`judge-sample.js` drew 18 pairs from our two mirrors (six within families, six `contains`, six same-title captures that
share some files but weren't joined). Two LLM agents judged each independently with `inspect.js` and `diff-images.js`,
picking a category from the design notes and quoting command output for every claim. The sample and verdicts are in
`tools/registry/pilot/`.

They agreed on 15 of the 18. The other three were ambiguous anyway: a menu rewritten for BASIC I, a PIAS re-release
differing by one byte in one screen, and a reworked loader both marked low confidence. The evidence checked out (both
cited the Plan B cheat disc poking `NOP`s over the `DEC`s at &3F74 and &3F82 that count down ammo and energy). The
judges also found a "compilation" that wasn't one, three gaps in the category list, and every mission file on the
protected Elite disc shifted by one, which is how the catalogue-reading bug above came to light. Eighteen pairs is a
small sample, nobody booted anything, and no person has judged the same pairs to compare.

## Sector dumps

Of the 427 FSD dumps on Matt's NAS, 425 parse. `fsd.js` fingerprints them directly and `fsd-study.js summary` prints
these numbers. Of the 398 that pair with a reconstruction, 350 give exactly its key and 34 more differ only because the
reconstruction fills unreadable tracks with `&E5`. Of the rest, 12 match a different dump of the same number, and two
differ over one overlong read.

The Empire Strikes Back pair was an artefact. Its track 10 has three sectors numbered 3 with two different contents,
the dump lists the track in a different order, and keeping the first copy picked different data. Keeping each
distinct content once, in byte order, gives the capture, dump and reconstruction one key. `repeated-ids.js` finds 11
images among the HFE images and dumps that repeat an ID with different contents (among them Mini Office, Clone and
Micro Mike Olympics, whose track 1 has ten different sectors numbered 0), and the change joins nothing but The Empire
Strikes Back. Keeping one copy would let discs that differ only in the dropped copy share a key, and a wrong match is
worse than a missed one. Counting copies doesn't work either, as the capture and dump read them in different orders
(`fsd-study.js track` lists them).

The other two pairs are real. The Philosophers Quest dump's sectors on track 33 are a shifted copy of the game's data,
while the capture's hold something found nowhere else, which looks like duplicator leftovers. The Hopper dump reads its
three differing bytes cleanly, so we can't yet say which copy is unusual.

Against captures of the same title, 140 of 201 reconstructions share a key, and most near misses differ in the
catalogue, as if the disc had been written to. Four captures hold `&E5` where the dump has unreadable tracks, which the
dump can't show, so a key from a dump with unreadable tracks should be recorded as provisional.

## Tapes

`tape.js` decodes UEF and CSW (jsbeeb has no CSW support), and `tape-index.js` fingerprints 2,101 images: 1,627 UEFs
from our Stairway To Hell mirror and the 474 from Matt's NAS. The key comes from the files and blocks the MOS would
read, as the containers differ a lot; of 132 titles we have as both UEF and CSW, the raw decoded bytes agree for one
and the key for 128.

2,100 get a key, making 1,737 distinct tapes. None of the 186 shared keys joins byte-identical images, so a file hash
would have found none of them, and the three shared by unrelated-looking titles are two spellings (FreeFall, JCB
Digger) and Jetpac on the unlabelled side of a Cosmic Battlezones tape. 103 images have blocks outside any complete
file, mostly files not starting at block 0, which looks like protection since those 103 make only 44 distinct keys.
Those blocks go into the key one by one, or the key would cover only the loader. 151 images carry over 1K in formats
of their own that we couldn't make agree between copies, so the key leaves them out.

2,296 of the 8,130 distinct tape files of 512 bytes or more also turn up on a disc, and 279 tapes have all their files
on one disc image, so tapes find disc records through file-level matching.

## ADFS

The main corpus has hardly any ADFS (two ADLs). Matt's NAS has 29 images, mostly copies of a few discs from old
emulator trees (Master Welcome discs, the ARM Evaluation System, the Master 512 boot disc), making 10 distinct keys;
copies agree and two versions of the Welcome disc don't. The nine distinct images jsbeeb loads give the same bytes
through the flux path. One ADFS L image is named `.ADF`, hence laying images out by size. ARM Evaluation System discs
4 and 5 share a second side of real data, another `ambiguous` case.

scarybeasts' 38 Master Compact captures (`adfs-survey.js`) give 38 distinct keys. Two copies of Play It Again Sam 3
differ in eight sectors on track 0, an alias case, and Grand Prix Construction Set and Karate Combat share a second
side. None is the same software as any ADFS image we have, so they can't yet show a capture matching a sector image,
but they settled [the fill](#trailing-fill).

## Symbols on a real game

We tried anchors on Repton 2, from George Foot's disassembly
([gfoot/repton2disassembly](https://github.com/gfoot/repton2disassembly), under the Unlicense). `anchors.js` works out
every address a store could reach and picks four-to-eight-byte runs of whole instructions at routine entry points that
no resolvable store touches, contain no `NOP` run and appear once in the region. It chose seven for the main code and
two each for two small regions. `anchors-run.js` booted the game headless and checked them every 20 ms for five
minutes of random play.

On our capture the main region matched at 22.00 s, 20 ms before its code was complete, and stayed matched through play
although over 8,000 bytes of the region changed; on the Stairway To Hell copy it matched 0.28 s early, during the
loader's copy. Repton 1 and 3 never matched an anchor. An earlier build had its main region rejected only because one
anchor sat on a routine it lacks, and had a small region accepted on two anchors although its bytes differ, so two
anchors is too few to prove much. A cheat disc, whose pokes had landed on `NOP` runs, keeps its labels now those
aren't anchors. Naming the regions and leaving out the disassembler's own loader were the only manual parts. The
published Repton 2 set is built from the same source by the importers in `tools/symbols/`; to rerun the experiment
from this repository's root:

```sh
git clone https://github.com/gfoot/repton2disassembly ../r2dis    # repton2.s, at c5fed37
node tools/registry/anchors.js ../r2dis/repton2.s --name repton2-disc --exclude-section 0x70a0 \
    --region 0x0d00=main --region 0x0380=music --region 0x0880=page8 --out ../r2set.json
node tools/registry/anchors-run.js ../r2set.json .registry-corpus/hfe/64D80D49.hfe \
    --listing ../r2dis/repton2.s --exclude-section 0x70a0 --seconds 300
```

## Anchors across titles

`anchor-collisions.js` measures how often bytes at an address turn up at the same address in another title, which
decides whether anchors pick out a disc or the code on it. It places every DFS file from the Stairway To Hell discs at
its load address (leaving out BASIC, files under 64 bytes, files of one repeated byte and page-zero loads), counts each
zip as a title (1,421 titles, 5,466 files) and samples up to three runs from each file of 1K or more, at least 256
bytes apart and not fill. That's 12,478 runs.

| Run length | Runs that turn up at the same address in another title |
| ---------: | -----------------------------------------------------: |
|    4 bytes |                                                  4,592 |
|    6 bytes |                                                  4,518 |
|    8 bytes |                                                  4,502 |

Going from four bytes to eight loses only 90, and chance matches would fall away fast with length, so nearly all of
these are the same code or data.

Taking a file's three runs, cut to six bytes, as a region's anchors, 1,355 of 4,104 files match in another title,
2,228 matches in all. 2,117 of those are 90% or more identical at the same addresses, 96 are 50% to 90%, 15 are 10% to
50% and none lower. We went through every match below 90% and every match between two publishers' folders, and all of
them are the same code or data: the same game in a compilation, cheat disc, re-release or other version; shared
engines (Level 9's interpreter in Level 9's and Mandarin's games, Graphic Adventure Creator's runtime, Scott Adams'
interpreter, Robico's adventure code, the Repton 3 engine on its data discs); a publisher's reused loader; and a few
files that turn up in two publishers' games (Trek II and Warp 1, Last of the Free and Quest for Freedom). The shares
below 90% are mostly engines with different data. `--examples` lists every match, lowest share first.

It's a proxy. Files sit at load addresses, so relocated or decrypted code is missed, protected originals and tapes are
left out, the runs are anywhere in a file rather than at entry points, and a match split across two files that load
together is missed. To rerun it:

```sh
node tools/registry/anchor-collisions.js --examples
```

## Booting the discs

All but the two ADL keys (7,363 of the 7,365 at the time) were booted headless in jsbeeb as a Model B with DFS 1.2 and
as a Master, holding SHIFT through power-on as the web page does, for 30 emulated seconds. `boot-survey.js` records
where the CPU is, what the VDU printed and what's on screen, and `boot-survey-analyse.js` prints the numbers. Between
20 and 30 seconds only 39 discs on the B and 34 on the Master go between booted and a clear failure, so 30 is long
enough.

Counting a disc as booted when it ends waiting for a key away from a BASIC prompt, or running code from RAM or BASIC,
87.6% boot on the B and 83.8% on the Master. Another 7% sit mostly in the MOS, which on the screens we looked at was a
title page polling for a key. HFE captures boot least (74.4% and 64.8%), which could be protection or gaps in jsbeeb's
disc emulation. 231 boots on the B printed an error and carried on, so an error alone isn't a failure.

307 discs boot only on the B and 62 only on the Master. Those are candidates for `requires`, but a quarter of the
Master-only ones are Electron releases, and some B-only ones look like gaps in jsbeeb's Master emulation (Holed Out
stops at its own "Master version loading" message). Where our capture notes name a machine (ten discs), the survey
agrees on five, can't tell on four and disagrees on one (Tank Attack); going by titles does worse. 323 discs boot on
neither, mostly boot option 0; the 113 that should autoboot and don't are the place to start a jsbeeb compatibility
list.

The screen recognises a disc pretty well. On 69% of booted discs a word of the disc's title appears on screen, against
3% for another disc's title, and where the catalogue title is blank or junk the screen still names the disc 63% of the
time.

## A look at Exile

Across our two mirrors, Exile falls into families quite naturally. The protected v1 and v2, each captured and
reconstructed from an FSD dump, now get whole-disc keys and agree with their reconstructions. The plain DFS v3 has
three copies: the two sides of a 40/80-track dual-format disc, which agree once the extra tracks trim away, and a
reconstruction differing only in the cycle number. Then there's Stairway To Hell's deprotected `Superior/Exile.ssd`
with its own loader, and cheat and editor discs that share `EXILEL`, `EXEDIT` and `MAPPER` with each other but not the
game. Shared files find all those families unaided; saying which is the original, a crack or a modified version is the
part that needs judgement.

---

This write-up was drafted by Claude (an LLM) with Matt, from experiments run with the tools in `tools/registry/`.
