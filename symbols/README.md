# Symbol sets

The sets, in the format "Symbol sets" in [the registry proposal](../docs/media-registry-proposal.md#symbol-sets)
describes. None of this data is under this repository's GPL; each set has its own `licence`, `source` and any
`notice` its licence asks copies to keep.

- `sets/`: the sets, one JSON file each.
- `configs/`: each title's config, from which its importer remakes its sets, and the title's in-memory check.
- `mos-sets.json`: the sets that may be marked `"system": true`. Only a MOS's set belongs on it.
- `index.json`: made from the sets by `npm run build-index`, never by hand. The pre-commit hook remakes it when a set
  is added or changed (not removed), and CI fails if it's stale.
- `titles.md`: the list of titles, made by `npm run build-index` with the index, from the configs and sets, and
  checked the same way.

## Where each set comes from

| Sets                                          | Source                                                                        | Importer                 |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| `bbc-b-mos-*.json`, `bbc-bplus-mos-2.00.json` | [TobyLobster's MOS reassemblies](https://github.com/TobyLobster/mos)          | `import-acme.js`         |
| `bbc-basic-2.json`                            | [acornaeology's BBC BASIC II](https://github.com/acornaeology/bbc-basic)      | `import-acornaeology.js` |
| `nfs-*.json`, `anfs-*.json`                   | [acornaeology's NFS and ANFS](https://github.com/acornaeology/acorn-nfs)      | `import-acornaeology.js` |
| `pipeline-*.json`                             | [PIPELINE's source](https://github.com/mattgodbolt/pipeline-disasm)           | `import-baron.js`        |
| `scorched-earth-game.json`                    | [Scorched Earth's source](https://github.com/mattgodbolt/beeb-scorched-earth) | `import-baron.js`        |
| `nevryon-game.json`                           | [Nevryon's disassembly](https://github.com/waitingforvsync/nevryon)           | `import-beebasm.js`      |
| `daredevil-demis-game.json`                   | [Daredevil Demis's source](https://github.com/mattgodbolt/daredevil-demis)    | `import-beebasm.js`      |
| `frogman-*.json`                              | [Frogman's source](https://github.com/mattgodbolt/frogman)                    | `import-beebasm.js`      |
| `xmos-rom.json`                               | [XMOS's source](https://github.com/mattgodbolt/xmos)                          | `import-beebasm.js`      |
| `xmos-1992-rom.json`                          | [XMOS's source](https://github.com/mattgodbolt/xmos), its 1992 branch         | `import-beebasm.js`      |
| `repton2-game.json`                           | [Repton 2's disassembly](https://github.com/gfoot/repton2disassembly)         | `import-py8dis.js`       |
| `dfs-2.26-*.json`                             | [py8dis's DFS 2.26 example](https://github.com/ZornsLemma/py8dis)             | `import-py8dis.js`       |
| `planb-game.json`                             | [py8dis's Plan B example](https://github.com/ZornsLemma/py8dis)               | `import-py8dis.js`       |
| `chuckie-egg-game.json`                       | [py8dis's Chuckie Egg example](https://github.com/ZornsLemma/py8dis)          | `import-py8dis.js`       |
| `lisp-4.06-rom.json`                          | [py8dis's LISP 4.06 example](https://github.com/ZornsLemma/py8dis)            | `import-py8dis.js`       |
| the level7 titles' sets                       | [level7's disassemblies](https://www.level7.org.uk/miscellany/)               | `import-level7.js`       |

The importers are under `tools/symbols/`, and each config pins its source's commit.
[The importers' doc](../docs/symbol-importers.md) says how to remake and check each set.
