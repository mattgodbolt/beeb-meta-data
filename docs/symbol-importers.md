# Symbol set importers

The sets under `symbols/sets/` are made from each title's source by an importer, driven by a curator's config in
`symbols/configs/`. This is how to get from a source repository to a set in the format "Symbol sets" in
[the media registry proposal](media-registry-proposal.md#symbol-sets) describes.

The source repository never changes for us and needs no build rules. The importer fetches it at the config's commit
and builds it itself: baron with `--symbols` and `-vv` for a baron title, beebasm with `-v` and `-dd` for a beebasm one,
the control script under py8dis for a py8dis disassembly. The config holds what only a curator knows, which is which
programs make a set, where a program's memory changes while it runs (so where its regions are cut), and anything the
anchor chooser needs told. Every importer feeds the same anchor chooser (`tools/symbols/anchor-chooser.js`) and the
index's checks.

## Running it

Each importer writes `<id>-<set id>.json` for every set in the config, then `build-index.js` checks them all and
rewrites `symbols/index.json`.

```sh
node tools/symbols/import-baron.js --config symbols/configs/pipeline.json
node tools/symbols/import-beebasm.js --config symbols/configs/nevryon.json
node tools/symbols/import-py8dis.js --config symbols/configs/repton2.json
node tools/symbols/import-acornaeology.js --config symbols/configs/bbc-basic-2.json
node tools/symbols/build-index.js
```

Then the two checks, for any title but a ROM:

```sh
node tools/symbols/corpus-check.js --config symbols/configs/pipeline.json --corpus .registry-corpus/sth-disc
node tools/symbols/check-memory.js --config symbols/configs/pipeline.json
```

`tools/registry/fetch-corpus.js` downloads the corpus into `.registry-corpus/`.

The importers fetch the config's commit into a temporary directory, or take `--source`, a clean checkout of it. Every
importer takes `--verbose`, which lists each name left out and why, and each anchor added to tell another image apart;
all but acornaeology's take `--out` for somewhere other than `symbols/sets`. They write nothing if a region can't be
anchored, if its anchors all match another image in the build, if a set fails the index's checks, or if the checkout
isn't of the config's commit or has changes.

The tools each importer needs, and where it looks for them:

| Importer                 | Needs                 | Found from                                    |
| ------------------------ | --------------------- | --------------------------------------------- |
| `import-baron.js`        | baron 0.5.0 or later  | `--baron`, `$BARON`, else `baron`             |
| `import-beebasm.js`      | beebasm 1.11 or later | `--beebasm`, `$BEEBASM`, else `beebasm`       |
| `import-py8dis.js`       | Python 3, and py8dis  | `--python`, `$PYTHON`, else `python3`         |
| `import-acornaeology.js` | the network           | jsbeeb's ROMs come from `node_modules/jsbeeb` |
| `make-mos-set.js`        | Python 3              | `python3`                                     |
| `import-level7.js`       | the network           | `--source`, a copy of the disassembly         |

Baron before 0.5.0 wrote a flat symbol dump, which the importer refuses. The in-memory check doesn't read the dumps,
so any baron that builds the source does for that. For beebasm, the sets here were made with
[stardot/beebasm](https://github.com/stardot/beebasm) at `ca2cc5f`; Ubuntu's snap of 1.10 can't write under `/tmp`,
where the build runs. The corpus check and the in-memory check take the same `--source`, `--baron`, `--beebasm`,
`--py8dis` and `--python` as the importers, since they build the title the same way (`tools/symbols/title-build.js`
picks the importer from the config). The py8dis importer fetches py8dis at the config's commit, or takes `--py8dis`, a
clean checkout of it. The in-memory check also takes scenario names to run only those, and `--shots DIR` to save the
screenshots a scenario asks for.

## A title's config

`symbols/configs/<title>.json` names the title's sets and says where each is cut, in the source's own names. Nothing
in it is an address list; the names come from the build. This is a baron title's; the
[beebasm](#beebasm-titles), [py8dis](#py8dis-disassemblies) and [acornaeology](#acornaeologys-roms) sections say how
theirs differ.

- `id` is the prefix of the title's set files.
- `licence`, `notice`, `madeFrom`, and `home` if the author has a page of their own for the work, are copied into
  every set.
- `source` says where the source is and what of it to assemble.
  - `assembler` is `baron` unless it says `beebasm`.
  - `repository` and `commit` pin the source. Each set's `source` links the tree there, or the file `link` names
    where the work is one file of a bigger repository, and for a repository on GitHub each name links to the line
    that defines it at that commit.
  - `assemble` is globs, from the repository's root, of every source to assemble, not only those that make a set,
    since the anchors are chosen against everything the title puts in memory.
  - `defines` predefines symbols, name to a baron expression, passed as `-D name=expression`. This is for what the
    title's own build passes (a build stamp the code prints, say), without which the source wouldn't rebuild the disc.
  - `disc` is the original disc in the repository, the one the source rebuilds. Its image key has to be one of
    `madeFrom`'s, and it's the disc the in-memory check boots.
- `leftToSystemSets` lists INCLUDEd files whose names the MOS's set already gives. The listing doesn't mark where an
  INCLUDE ends, so these are the `=` names shown straight after the INCLUDE line.
- `bytesPerAnchor` and `spreadAnchors` ask for at least one anchor per that many bytes of a region, up to that many,
  before the anchors that tell other programs apart.
- `check` is the module of scenarios for the in-memory check, `<title>-check.js` beside the config.
- `sets` each have an `id`, a `title`, the `sources` that make it, and its `regions`, and can also have
  - `stripScope`, a scope that wraps the whole program, left off its names;
  - `tableSizes`, tables written with an index, by name, with how far the index goes (an expression);
  - `moves`, labels of the copies that put the program in place, whose stores don't keep anchors off what they copy.
    A label takes the store it's on, and if a loop in its section branches back to it, the loop's indexed stores up
    to the last branch back;
  - `globalsSections`, sections whose labels are the program's globals (zero page, say, which holds no code and which
    every program writes, so couldn't be anchored).
- A region is a SECTION (`section`, plus `source` if it's not in the set's first), or the part of one between `from`
  and `to`, expressions in the source's names (`pl.encrypted - 1`, `menu_screen + &700`). It can also have
  `overwritten`, for run-once code that something else writes over when it's done, so only its own stores keep
  anchors off its bytes; and `avoid`, `[from, to)` ranges no anchor may cover beyond what the chooser finds itself.

## Names

How the baron importer picks names. Every label in the listing has to agree with the symbol dump, or the import stops;
the dump is what baron resolved, and the listing is where the scopes, sections and bytes come from.

- Labels go to the region of the section they're assembled in, qualified with their scopes
  (`select_sprite.down_not_0f`), less the set's `stripScope`. A label at a section's exclusive end (`main_code_end`) is
  in no region and is left out, as is anything in an anonymous scope (baron's `@` names).
- A virtual section's labels (`SECTION zero_page, org=&00, virtual=TRUE`) are globals, since the section keeps no
  bytes. A program can include another's layout just to reckon offsets from it, so a label no instruction uses as a
  memory operand is kept only if some statement mentions it (`EQUW slot_28`, `LDA #LO(io_maps)`, but not a `=` line
  or a string) and a statement reserving space (a SKIP, or an EQUW that keeps no bytes) starts at it.
- `=` names count as addresses when an instruction uses them as a memory operand: the operand's first name, not after
  `#`, not a FUNCTION's result, and not one `leftToSystemSets` covers. Such a name goes to the region it points into
  if only that region's code uses it, and is a global otherwise.
- There's one name per address. In a region, a scope's own name wins over the labels inside it (`pl` over
  `pl.start`), then the label written last, nearest the bytes (`tune` over `sound_data`). In the globals it's the `=`
  name or virtual section label the most instructions use as a memory operand; a label of a `globalsSections`
  section, or a virtual one only data mentions, counts as used by none.
- Each name's place is the file and line the symbol dump says defines it (`src/game.6502#L120`), which goes in the
  set's `places` for a GitHub repository. There, a name the dump gives no place stops the import. A `defines` entry
  (Scorched Earth's `BUILD`) has no line, so it's never a name in a set.

Every importer links names back to the author's own work where it can, with the set's `home`, `nameLink` and
`places`. Source on GitHub links to the line at the pinned commit; an acornaeology disassembly links to its per-address
anchors. Where the author has no site of their own (py8dis's `acorn.py` for the MOS), `source` is the only link.

## Anchors

Candidates are runs of 4 to 8 bytes of the region's own statements: whole instructions from an instruction's start
(aiming for 6 bytes), or data from any byte. A candidate is out if any of its bytes is

- reached by a store whose target the instruction gives (an indexed store reaches 256 bytes, or all of zero page,
  unless `tableSizes` says otherwise), except that a run-once region only minds its own stores, and the copies in
  `moves` don't count;
- in a block the code hands the OS (`LDX #LO(block)`), which OSWORD, OSFILE and OSGBPB write results into, from its
  label to the next one that starts code or another block, 18 bytes at most;
- SKIP or SKIPTO padding, or under a label with `unused`, `leftover`, `junk`, `spare` or `stray` as a word of any of
  its scopes, up to the next label;
- in a BASIC program (a section saved to run at `&8023`), its first line, any line's CR, number and length, or a REM's
  text (but not code in the REM);
- in `&FC00-&FEFF`, or in an `avoid` range;

or if the run calls into the MOS (`JSR` or `JMP` to `&C000` up), has two NOPs together (where cheats poke), has fewer
than four different bytes, or appears twice in the region.

From those it picks about one anchor per `bytesPerAnchor` of the region (`spreadAnchors` at most), spread over it,
preferring a label, then code, then the most different bytes. Then it looks at every other image of the region's
addresses in the build (every section of every source where it runs, every file where it loads). An image that holds
all the anchors and agrees with them gets another anchor where it differs, or the import fails. Another program's
image of any part of the region gets an anchor inside that part where it differs, if there is one, so that a
leftover stops matching once part of it is overwritten; when there isn't one the importer prints a note.

## The checks

The corpus check places every complete DFS file on every disc in the corpus at its load address and lists, for each
region, every title whose files hold all its anchors, with how much of the region they hold and how much of that is
identical. 90% identical or more is the same code (a crack, a compilation); anything less is a collision, and the check
exits 1. Since files sit at their load addresses, code a program moves to where it runs is only compared with other
titles' files that load there.

The in-memory check boots the title's disc in a headless jsbeeb (a B with DFS 1.2 unless the scenarios' `machines`
names another model, a second processor, or no SHIFT+BREAK) and, at each moment a scenario picks, lists the regions
whose anchors all match. A moment fails unless that's exactly the regions expected, or if two matching regions
overlap (of one set or two), since the debugger then shows neither.

Neither takes an acornaeology config. For a ROM, the importer's own comparison against every ROM jsbeeb has stands in
for the corpus check, and `tests/symbols/test-shipped-rom-sets.js` checks the set against those ROMs.

## What the baron importer gets wrong

- A program's zero page used differently in different regions loses names, since a set's globals hold one name per
  address. PIPELINE's game loader's `copy_return`, `copy_from` and `menu_keys` give way to the main code's
  `monster_x`, `monster_direction` and `work0`. Baron's `ZA_AUTO`, which gives routines that never run together the
  same zero page, does the same to Scorched Earth.
- The operand rule misses `=` names the code reaches only through an immediate's `LO()`/`HI()`, a FUNCTION or a table
  of addresses, and takes a name used only in dead code as readily as any other.
- Stores through a pointer, or by the OS into a block it wasn't passed with `LDX #LO(...)`, aren't seen. The
  `LDX #LO(...)` rule also over-blocks OSCLI strings, which the OS only reads.
- The config's hand-written knowledge (where to cut, table sizes, moving copies) is by name, so a change to the code
  needs the config looked at; a misspelt name stops the import.
- The "another program's image" rule adds anchors for meetings that never happen: PIPELINE's MISSION gets one in
  TITLE's unpacker page and one in the game's loader, which no route through the menu puts beside it.
- Data anchors in text land wherever the spread puts them.

The importer reads operands back out of the `-vv` listing's text, which is why it can't follow a FUNCTION, until
baron gives the symbol each operand was written with ([baron#14](https://github.com/waitingforvsync/baron/issues/14)).

## beebasm titles

A beebasm title's config differs from a baron title's in a few ways.

- `source.assemble` is the one main source, and `source.directory` is where beebasm runs (the repository's root if
  none), since beebasm finds an INCLUDE from where it runs rather than from the file that INCLUDEs it.
- A region names a saved file, `file`, as its SAVE writes it (`"../build/CODE"`), instead of a section, and can be cut
  with `from` and `to`. beebasm has no sections; a SAVE writes whatever is in memory between two addresses.
- There's no `defines`, `stripScope`, `tableSizes`, `moves`, `globalsSections` or `leftToSystemSets` yet, as nothing
  has needed them.

The build copies the checkout (a SAVE writes wherever its source says) and runs beebasm with `-v -dd -labels` on a
wrapper that INCLUDEs the main source and then PRINTs each name the sources assign with `=`, since beebasm's dumps
hold labels only. A name the wrapper can't PRINT, because it was assigned inside braces or a loop, is dropped and the
build run again.

Names and anchors come out much as for baron, with these differences.

- beebasm doesn't say where a saved file starts, so the importer takes the address, among those listed before its
  SAVE, from which the file agrees with every statement it covers and covers the most. Its statements are those in
  memory when it was saved, so a block assembled over another after a CLEAR belongs to the files saved after it.
  SKIPTO and ALIGN padding never anchors.
- A label in a scope with no label of its own (a FOR loop's pass, a macro's call) is left out, as baron's `@` scopes
  are.
- A `=` name counts as an address when the sources write it first in a non-immediate operand (`LDA ptr`,
  `STA (vec),Y`), an instruction of the set's files uses its value as a memory operand, the MOS set doesn't name that
  address, no label of the set's regions is at it, and no other name passing the same tests has the same value. Names
  that share a value are all left out, since the listing's operands are numbers and which name an instruction was
  written with is never known.
- An OS block is an `LDX #lo` beside an `LDY #hi` that make a label's address.
- The original disc's files, where its catalogue loads them, are among the images the anchors are chosen to tell
  apart.
- Each name's place is the line of an INCLUDEd file that defines it, as a label (`.name`) or with `=`, outside strings
  and comments; a scoped name (`start.loop`) is found by its last part. A name that no line, or more than one, defines
  stops the import.

What it gets wrong, beyond the baron importer's list: names shared by code that doesn't run together (a sound driver's
and a title screen's workspace at one zero page address) are left out; a `=` name used only in an expression's later
term (`LDA base + ptr`) or a macro's argument isn't seen as an operand, and the text search takes a name in a comment
as readily as one in code; a label in braces that don't start at it (`.routine LDA #0 : {`) loses its scope's name, and
every label inside is left out; and a file loaded in one place and run in another is only compared with the corpus
where it loads, so the corpus check never sees Nevryon's CODE (loaded at `&0E00`, run at `&1100`).

## py8dis disassemblies

A [py8dis](https://github.com/ZornsLemma/py8dis) disassembly is a control script that loads a binary, says where
pieces of it are `move()`d to run, and names addresses. `py8dis-dump.py` runs the script under py8dis, lets it trace
and classify the binary as it would to emit assembly, and prints what py8dis then holds as JSON: each piece where it
runs, every instruction and data line with its bytes, and every name with the move it was given in. So the names and
anchors never come from py8dis's assembly output. The importer runs Python with `-I` and `-B` from a directory of its
own, so neither checkout's files get imported by accident or gain any.

The config differs from a baron title's in these.

- `source.script` is the control script, from the repository's root. `source.directory`, if given, is where it runs
  (and so where the paths it loads from start); otherwise it runs in its own directory.
- `source.assembly` is the assembly the repository holds (`repton2.s`), if any. On GitHub, each name links to the line
  that starts with it, as a label (`name:` or `.name`) or a constant (`name =`), and a name that no line, or more than
  one, starts stops the import.
- `py8dis` gives the `repository` and `commit` of the py8dis to run it under.
- `disc` is the disc the in-memory check boots, when the repository has none: the `url` of a zip, the `image`'s path
  in it, and its `key`.
- A region is `from` an address `to` another (the end of `from`'s piece if not given), expressions in the script's
  names. It has to lie in one piece: the one running at `from`, else the one holding the name `piece` gives, where two
  run at the same address (`from` is then the piece's start if not given). With `loaded`, it's the binary where it
  loads instead, as a ROM sits in memory.
- `rom`, for a ROM, is its file under jsbeeb's `public/roms/`, or for one jsbeeb doesn't have, the `url` of a copy
  and its `key`, which the in-memory check fetches and puts in sideways RAM. The binary has to be that ROM, which gives
  the sets' `madeFrom`, and the anchors tell it apart from every other ROM jsbeeb has and from their own copies of the
  code it moves (the same Tube host at `&0400`, say), found by the runs of 8 bytes they share.
- `leaveOut` is regular expressions for names to leave out, such as a script's placeholders (`XXX` in DFS 2.26's).
- `moves` and `tableSizes` are expressions too, since a script names few of the instructions it traces
  (`boot_relocate_0380_loop + 3`). A table is the store's operand exactly, so `STA table+1,X` is `table + 1`. A move
  can name a copy loop's first instruction; the loop is the one in the piece with an instruction there, or in any
  piece if none or several have one.

A name goes to the region holding its address in its move's piece, or in the binary as loaded for a name no move gave.
One in a piece no region holds (a loader the disassembly added) is left out; one outside every piece is a global. The
first name the script gives an address wins. A name given two addresses stops the import, since a config expression
using it couldn't say which it means. The names py8dis makes up (`l0070`, `sub_c1234`), expressions (`zp_ptr+1`),
constants, and `acorn.py`'s OS and hardware names are left out.

For anchors, nothing marks the blocks code hands the OS, py8dis has no SKIP, and every store counts, the
disassembly's own loader included, unless `moves` says it's a copy.

Control scripts written in September 2021 import `trace6502` and call `acorn.add_standard_labels()`, which py8dis has
since renamed; `py8dis-dump.py` puts them back so such a script runs unchanged.

## acornaeology's ROMs

[acornaeology](https://github.com/acornaeology) publishes annotated disassemblies of Acorn's ROMs, each with a JSON
file (dasmos's schema 4) of every statement with its bytes and labels, plus `external_labels` for addresses outside the
ROM. `import-acornaeology.js` makes a set from one; only BBC BASIC II has a config so far, though the NFS, ANFS and ADFS
repositories publish the same schema.

A config has `"importer": "acornaeology"`, an `id` (also the set's file name), a `title`, the `licence`, and

- `source`, with the `repository`, the `commit`, the `disassembly` JSON's path in it, and the `licenceFile` whose text
  becomes the set's notice;
- `rom`, the file under jsbeeb's `public/roms/` the set is anchored on (from the `jsbeeb` package in
  `node_modules`); the importer refuses a JSON whose bytes aren't that ROM's;
- `regions`, each a `name`, `start` and `end`. A sideways ROM is cut at `&9000` and `&B000`, for the reason the
  proposal gives;
- `globals`, the ranges whose `external_labels` become the set's globals;
- `bytesPerAnchor` and `spreadAnchors`, as for baron;
- `home`, the disassembly's page on acornaeology's site. The importer fetches it, and each name whose address has an
  anchor there (`id="addr-800E"`) links to it. The page only has anchors inside the ROM, so globals get no links, and
  a name in the ROM with no anchor stops the import.

Every label of a statement goes to the region holding it. A name outside the ROM is a global if it's in a `globals`
range and no system set names its address, so the MOS's names for its vectors stay the MOS's; where two share an
address, the one the JSON's `memory_map` describes wins. Constants and comments are never read. For anchors, the whole
ROM is one section with no stores, and every bank of every ROM file jsbeeb has that's a whole number of the ROM's size
is another image to tell it apart from.

The set isn't `system`, so BASIC's workspace names only name BASIC's own code's operands, and a game run from BASIC
keeps its own names for the zero page they share.

## PIPELINE

`symbols/configs/pipeline.json` makes one set per program from
[pipeline-disasm](https://github.com/mattgodbolt/pipeline-disasm). Each program runs on its own with its own zero page,
so a set per program keeps the game's `&70` (`cell_x`) apart from the Graphics Designer's (`sprite_width`) and the
GRAPHIC stub's (`sectors_this_read`). A stub and the program it loads are often in memory together, but not always,
so they're separate sets; the three stubs are one source assembled three times, told apart by their anchor at
`read_whole_run`. WDATA, which the Level Designer loads at its start and keeps, is a region of the Level Designer's
set. IO, LEVEL1 and DEFAULT come in as their programs' globals, and the other data files are pictures or `*EXEC` text.
MENU and MISSION are BASIC, but each holds labelled machine code (MENU's scroller, MISSION's scrambler in a REM), so
each has a set.

Where the regions are cut:

- The game has its loader (H.GAME as loaded at `&3000`, `overwritten` by IO) and the four pieces it copies, each where
  it runs. `main_code` is cut at `SWAP_START` and `SWAP_END`, which `load_mission` swaps into the screen while IO
  loads, and `game_start` is a region of its own, since the level's objects are copied over it once it has run.
  `tableSizes` gives the four indexed tables in zero page and the stack page; at 256 bytes each their stores would
  leave `event_handler` nothing to anchor on.
- The Level Designer has `main`; `startup` (`entry` and the stored zero page, low code and font), which the level being
  edited fills; the low code and font where `entry` moves them (the two `moves`); and WDATA. Its zero page section is
  in `globalsSections`.
- TITLE is the file as loaded, which the picture unpacks over, and `unpack`, the part it moves to `&2F18` to run.
- PL is the decryptor, the encrypted bytes, and the cheat they decrypt to. The decryptor's last byte, a BMI opcode, is
  also the cheat's first instruction, so the decryptor is cut one byte early; otherwise both regions match there once
  PL has run, and the debugger would show neither.
- MENU is the BASIC program, the scroller and its message (C%), and the menu screen (S%), whose leftovers past its end
  are `avoid`ed.

## Scorched Earth

`symbols/configs/scorched-earth.json` makes one set, the game, from
[beeb-scorched-earth](https://github.com/mattgodbolt/beeb-scorched-earth). INTRO, the BASIC that `!BOOT` chains, has
no names and no set; the in-memory check makes sure nothing matches while it runs.

- The game prints a build stamp its Makefile passes as `-D BUILD=...`, so `defines` gives the shipped disc's stamp.
  Without it the code after the stamp would move.
- SCORCH loads at `&1900` and copies the game down to `&0E00`, over where it was loaded, so the loader region is only
  its own code from `loader`. As loaded, it would match beside the game it copied down.
- `startup` runs once from `skyrow` and `dirtrow`, which the first round fills. Before calling the game it copies five
  tables into holes below `&0E00` (the bottom of the stack page, the cassette workspace, the printer buffer, the
  user-defined characters and the NMI area), each a region of its own. Its copy loops, and the loader's, are `moves`.
- `tableSizes` keeps the per-player and per-shell arrays from reaching over the low tables beside them and the start
  of the code. `profile`'s runs up to `fall_x`, since napalm's `liquid` is the same address and runs over three tables.
- The workspace sections are `globalsSections`, and `defs.6502`'s OS and hardware names are left to the MOS set.
- `avoid` keeps anchors off the talk lines, which are Wendell Hicken's, not the MIT licence's.

## Repton 2

`symbols/configs/repton2.json` makes one set from George Foot's
[repton2disassembly](https://github.com/gfoot/repton2disassembly), whose `repton2.bin` is the game's code as it sits in
memory once loaded, with a loader of his own appended. The repository doesn't say which py8dis made `repton2.s`, and
none from around when it was committed remakes it; the config's py8dis (`2a60463`) runs the script, with the two names
`py8dis-dump.py` puts back, and gives every name at the address `repton2.s` has it.

The regions are where the game runs: `main` (`&0D00-&5FFF`, up to the screen), and the two pieces the loader moves,
`music` to `&0380` and `page8` to `&0880`. The loader at `&70A0` is the disassembly's, not the game's, so it has no
region; its copies are `moves`, or their indexed stores would leave the two pieces nothing to anchor on. The disc is
Stairway to Hell's `Superior/Repton2.zip`, whose `D.REPB` is the game encrypted; once its loader has run, the three
regions hold `repton2.bin`'s bytes exactly.

## DFS 2.26

`symbols/configs/dfs-2.26.json` makes two sets from py8dis's own example, `examples/python/dfs226.py`, whose binary is
jsbeeb's `b1770/dfs1770.rom` (and `bp/dfs.rom`, the same bytes). `rom` is the ROM, cut at `&9000` and `&B000`, and
the two NMI handlers it copies to `&0D00` that can be anchored: the read handler, and the one its 8271 compatibility
mode (Z+BREAK) reads with. The write handler copies 14 bytes over the read handler's middle; its only bytes that
differ from the Master's DFS 2.24 are three the 4 byte minimum can't reach, so it has no region, and the read handler
has an anchor there so as not to match while it's in place. `tube` is the Tube host at `&0400` and `&0500`, a set of
its own since DFS 1.2 installs the same page 5, which it rightly matches. The zero page part of the Tube host has no
region, since every `STA zp,X` of the ROM reaches it. `tableSizes` gives the NMI handler's address operands, which the
ROM stores into with X of 0 or 3.

The in-memory check runs disc commands on a B1770, with and without a second processor, and checks DFS 1.2's and a
Master's machines match nothing but DFS 1.2's page 5. It holds Z through a power-on reset for the 8271 mode: through
a soft BREAK, the DFS puts its saved workspace back over the OSBYTE hook the mode has just made, and the next OSBYTE
meets a BRK. Its scenarios say which machine they want with `machines`.

## Plan B

`symbols/configs/planb.json` makes one set, `game`, from py8dis's example `examples/python/planb.py`, TobyLobster's
disassembly of Bug Byte's game: one region over the binary, which runs where it loads. The disc is Stairway to Hell's
`BugByte/PlanB.zip`, whose `PLANB` differs from the example's binary in two operands of one OSBYTE call at
`title_and_game_loop`, which no anchor covers. TobyLobster's own PlanB repository has no licence, so the set comes
from py8dis's copy, under py8dis's.

## LISP 4.06

`symbols/configs/lisp-4.06.json` makes one set, `rom`, from py8dis's example `examples/python/lisp406.py`,
TobyLobster's disassembly with Acornsoft's own label names, cut at `&9000` and `&B000`. jsbeeb doesn't have the ROM.
The example's binary is byte for byte the `LISP406` on mdfs.net, whose SHA-1 MAME's `bbc_rom.xml` also lists for LISP
4.06, so the config names that copy. The in-memory check puts it in sideways RAM on a B, and checks it matches only
while LISP is paged in. Stairway to Hell's `Lisp_B` tape is an earlier version that loads into RAM, and shares little
with it.

## Nevryon

`symbols/configs/nevryon.json` makes one set, `game`, from [nevryon](https://github.com/waitingforvsync/nevryon)'s
disassembly, from the four files its master source saves (CODE, CODE2, CODE3 and GRAPHIX), each where the loader puts
it. The repository's disc is Stairway to Hell's `4thDimension/Nevryon.zip`, byte for byte. GRAPHIX starts 16 bytes in,
because CODE3 ends 16 bytes into it and LOADER3 loads CODE3 after Loader2 has loaded GRAPHIX. The loader's menu, which
shows a picture over where GRAPHIX goes, matches nothing; the game's own title screen and play match all four.

## Daredevil Demis

`symbols/configs/daredevil-demis.json` makes one set, `game`, from
[daredevil-demis](https://github.com/mattgodbolt/daredevil-demis): one region over its one saved file, which runs where
it loads. The repository's disc, the one jsbeeb's GitHub disc list serves, is what the source builds. Its modules
share zero page workspace (`strp`, `sfx_ptr` and `ttl_str` are all `&90`), so those addresses go unnamed.

## level7's disassemblies

[level7](https://www.level7.org.uk/miscellany/) has disassemblies of 75 games as plain text, by an author who doesn't
give their name. Each says the author "imposes no additional copyright restrictions beyond those already present on the
game itself" and that it's "provided for educational purposes only"; Matt agreed to use them on that basis, borrowing
the names and linking back. So a set's `licence` is `LicenseRef-level7-educational`, and its `notice` quotes that
paragraph from the file, which the importer refuses a file without.

`level7-text.js` reads a file. A statement is a line of its address and bytes, and an instruction if a mnemonic
follows (`&1400 a9 13    LDA #&13`); a label is a line of its own before its statement (`; entry_point`); and an
instruction's operand is often followed by the name of what it addresses (`STA &8f ; code_address_high`). A heading
(`Game disassembly`, underlined) or a file's header (`; HOPPER` and then `; ff0e00 ff8023 000800`) starts a part. Code
the program moves is listed where it runs, after a note that says so, and the importer takes the note's copying
instruction as a move (`# &3200 - &33ff is copied to &0900 - &0aff at &3011`). An instruction followed by `#
actually` or `# or` changes as the program runs, so its bytes never anchor. An instruction whose bytes don't fit its
operand (`STA &01A`, `LDA &....`) is read as data.

A config has `"importer": "level7"`, and differs from a py8dis title's in these.

- `source` is the file's `disassembly` URL and the `sha256` of what was fetched. `--source` takes a copy instead.
- A set can name its `part`, by its file's name or its heading, and so can a region; a region is `from` and `to`, in
  label names or addresses, and needs a part when more than one part has statements there.
- A region's `leaveOut` names pieces of its part, by the address they start at, that aren't where it runs: a
  disassembly sometimes lists a routine "used unrelocated" at its load address amid the relocated code.
- Two statements that disagree at an address are a typo in one address, and neither is kept.

Names come from labels in the set's regions: the last before a statement wins, and a name the file gives several
addresses (`leave`, `unused`) is left out. Globals are the names the set's own instructions give addresses outside
its regions, below `&8000`, unless a label or the MOS's set has them; an address with several takes the one most
instructions use. There are no anchors in a text file, so a name's place is a
[text fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments): the name and as
many of the words after it as make the label line the first match (`hopper-disassembly.txt#:~:text=update_object,-%23%20Called`),
else the statement's address and the words after it; a global's is its first mention. The files are often of the tape
version. `tools/symbols/level7-compare.js --config <file>` boots the config's disc and says how much of each run of
statements memory holds, which is how to choose a title and its regions.

Hopper, Super Invaders, Arcadians, Starship Command and Syncron have sets. Their discs run the code the files list,
relocated as the files list it; none loads where it runs, so the corpus check finds nothing to compare. Each `main`
stops where the screen starts, and run-once loader code (Hopper's `startup`, Arcadians' `relocate`, Starship Command's
`entry`) has a region of its own. Arcadians' main leaves out the four routines the file lists unrelocated.
