# beeb-meta-data

Metadata about BBC Micro software, for emulators to fetch. Today that's **symbol sets**, which name the code and
data of programs in a debugger; later it'll be **records** saying what a disc or tape is (its title, which machine it
needs, its keys). [jsbeeb](https://github.com/mattgodbolt/jsbeeb) is the first client, but nothing in the data is
specific to it.

It's published as static JSON under `https://bbc.xania.org/meta/`, with the sets' index at
[`meta/symbols/index.json`](https://bbc.xania.org/meta/symbols/index.json). A set is found by anchors, short runs of
bytes in memory, rather than by which disc was loaded, so its names turn up wherever the code came from. The overview
at the top of [the proposal](docs/media-registry-proposal.md) explains keys, records, sets and the index in a few
paragraphs.

## Layout

| Path              | What                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `symbols/`        | The sets, their index, and each title's import config ([README](symbols/README.md))           |
| `tools/symbols/`  | Importers (baron, beebasm, py8dis, acornaeology, ACME, the MOS), the index build, the checks  |
| `tools/registry/` | Experiments for records: fingerprints, the corpus survey ([README](tools/registry/README.md)) |
| `tools/dist.js`   | Lays out what's published, under `dist/meta/`                                                 |
| `docs/`           | The reference docs, below                                                                     |
| `tests/`          | Unit tests for all of the above, and the real sets against jsbeeb's real ROMs                 |

The tools use jsbeeb as a library (its symbol-set parser, its disc code and a headless machine) at the version
`package.json` pins, so the checks here are the ones the client makes.

## Working on it

Needs Node 24 (see `.nvmrc`).

```sh
npm install          # also installs the pre-commit hook
npm test             # unit tests
npm run ci-checks    # lint, formatting, and that symbols/index.json is up to date
npm run build-index  # remake symbols/index.json after changing a set
npm run dist         # what the deploy would publish, in dist/
```

Adding a title is in [Adding a title](docs/adding-a-title.md), which says what order to do things in and the rules
we settled; [the importers' doc](docs/symbol-importers.md) is the reference for each importer.

CI tests every push. A push to `main`, or a manual run there, also uploads the `dist/` it built to
`s3://bbc.xania.org/meta/`, the sets first and the index last. Nothing published is ever deleted, and files are served
with a five-minute cache lifetime, so a change is live within minutes of reaching `main`.

## Reference

- [The registry proposal](docs/media-registry-proposal.md): keys, fingerprints, records, and the symbol-set format.
- [Adding a title](docs/adding-a-title.md): the steps, and the rules every set follows.
- [Symbol set importers](docs/symbol-importers.md): how each kind of source becomes sets, and each title's notes.
- [Design notes](docs/media-registry-design-notes.md): why it's built this way, prior art, exact rules.
- [Findings](docs/media-registry-findings.md): what surveying the archives turned up.

## Licences

The tools are GPL-3.0-or-later ([LICENSE](LICENSE)). The data isn't; each symbol set carries its own `licence`,
`source` and any `notice` its licence requires, and is used under that. Disc and tape images are never stored here.
