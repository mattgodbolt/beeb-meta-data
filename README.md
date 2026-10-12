# beeb-meta-data

Metadata about BBC Micro software, for emulators to fetch: today, **symbol sets** that name the code and data of
programs in a debugger; later, **records** that say what a disc or tape is (its title, which machine it needs, its
keys). [jsbeeb](https://github.com/mattgodbolt/jsbeeb) is the first client, but nothing in the published data is
specific to it.

It will be published as static JSON under `https://bbc.xania.org/meta/`, with CORS open to every origin, once the
deploy has credentials.

## The idea in brief

- **Symbol sets** are found by what's in memory, not by which disc was loaded. Each set cuts a program into
  **regions** (address ranges) and gives each region a few **anchors**: short runs of bytes that are always there
  when that code is. A client fetches `meta/symbols/index.json` (every set's regions and anchors, without the names),
  checks the anchors against memory whenever its debugger stops, and fetches a set's names only once its anchors
  match. So the names follow the program wherever it came from: a different dump of the disc, a compilation, a
  program loaded over the network.
- **Names come from other people's work**: disassemblies and sources with a licence that allows reuse. Each set
  records its `licence`, its `source` at a pinned commit, and links each name back to where its author defines it.
- **Records** (not built yet) will be keyed by a fingerprint of the disc or tape image, so a client can look up
  `meta/<key>.json` for any image without an index. [The proposal](docs/media-registry-proposal.md) describes them.

## Layout

| Path              | What                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `symbols/`        | The sets, their index, and each title's import config ([README](symbols/README.md))           |
| `tools/symbols/`  | Importers (baron, beebasm, py8dis, acornaeology, the MOS), the index build, the checks        |
| `tools/registry/` | Experiments for records: fingerprints, the corpus survey ([README](tools/registry/README.md)) |
| `tools/dist.js`   | Lays out what's published, under `dist/meta/`                                                 |
| `docs/`           | The reference docs, below                                                                     |
| `tests/`          | Unit tests for all of the above, and the real sets against jsbeeb's real ROMs                 |

The tools use jsbeeb as a library (its symbol-set parser, its disc code and a headless machine), from the version
`package.json` pins, so the checks here are the checks the client will make.

## Working on it

Needs Node 24 (see `.nvmrc`).

```sh
npm install          # also installs the pre-commit hook
npm test             # unit tests
npm run ci-checks    # lint, formatting, and that symbols/index.json is up to date
npm run build-index  # remake symbols/index.json after changing a set
npm run dist         # what the deploy would publish, in dist/
```

Adding or remaking a title's sets is in [the importers' doc](docs/symbol-importers.md).

Every push runs the tests in CI; a push to `main` also builds `dist/` and syncs it to `s3://bbc.xania.org/meta/`,
once the repository has AWS credentials.

## Reference

- [The registry proposal](docs/media-registry-proposal.md): keys, fingerprints, records, and the symbol-set format.
- [Symbol set importers](docs/symbol-importers.md): how each kind of source becomes sets, and each title's notes.
- [Design notes](docs/media-registry-design-notes.md): why it's built this way, prior art, exact rules.
- [Findings](docs/media-registry-findings.md): what surveying the archives turned up.

## Licences

The tools are GPL-3.0-or-later ([LICENSE](LICENSE)). The data isn't: each symbol set carries its own `licence`,
`source` and any `notice` its licence requires, and is used under that. Disc and tape images are never stored here.
