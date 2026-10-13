import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { formatText, readSets, SymbolsDir } from "../../tools/symbols/build-index.js";
import { kindOf, readConfigs, setFilesOf, titleRows, titlesMarkdown, TitlesFile } from "../../tools/symbols/titles.js";

const set = (title, regions, extra = {}) => ({
    title,
    licence: "MIT",
    source: "https://github.com/example/game/tree/0123abc",
    regions: Object.fromEntries(regions.map(([start, end], i) => [`r${i}`, { start, end }])),
    ...extra,
});

describe("the titles list", () => {
    describe("kindOf", () => {
        it("calls a title with a system set an operating system", () => {
            expect(kindOf([set("MOS", [["0xc000", "0x10000"]], { system: true })], { importer: "acme" })).toBe(
                "system",
            );
        });

        it("calls a title whose config names its ROM a sideways ROM, even with code in RAM", () => {
            const sets = [set("DFS", [["0x8000", "0xc000"]]), set("Tube host", [["0x0400", "0x0800"]])];
            expect(kindOf(sets, { rom: "b1770/dfs1770.rom" })).toBe("rom");
        });

        it("calls acornaeology's titles sideways ROMs", () => {
            expect(kindOf([set("BASIC", [["0x8000", "0xc000"]])], { importer: "acornaeology" })).toBe("rom");
        });

        it("calls anything else a program, even one with its data in a sideways bank", () => {
            expect(
                kindOf(
                    [
                        set("Game", [
                            ["0x0e00", "0x4400"],
                            ["0x8000", "0xbf9c"],
                        ]),
                    ],
                    {},
                ),
            ).toBe("program");
        });
    });

    describe("titleRows", () => {
        const game = { name: "game.json", config: { id: "game", sets: [{ id: "main" }] } };
        const both = { name: "both.json", config: { id: "both", name: "Both", sets: [{ id: "a" }, { id: "b" }] } };
        const bothSets = (licenceB = "MIT") =>
            new Map([
                ["sets/both-a.json", set("Both: A", [["0x1900", "0x2000"]], { home: "https://example.com/a" })],
                ["sets/both-b.json", set("Both: B", [["0x3000", "0x3100"]], { licence: licenceB })],
            ]);

        it("names a one-set title after its set, linking its home over its source", () => {
            const sets = new Map([
                ["sets/game-main.json", set("Game", [["0x1900", "0x2000"]], { home: "https://example.com/" })],
            ]);
            expect(titleRows([game], sets)).toEqual([
                { kind: "program", title: "Game", from: "https://example.com/", licence: "MIT" },
            ]);
        });

        it("names a title with several sets by its config's name, linking each set", () => {
            expect(titleRows([both], bothSets())[0]).toEqual({
                kind: "program",
                title: "Both",
                licence: "MIT",
                covers: [
                    { title: "Both: A", from: "https://example.com/a" },
                    { title: "Both: B", from: "https://github.com/example/game/tree/0123abc" },
                ],
            });
        });

        it("refuses a title with several sets and no name or different licences, or a set that isn't there", () => {
            const unnamed = { name: "two.json", config: { ...both.config, id: "two", name: undefined } };
            const sets = new Map([...bothSets()].map(([file, json]) => [file.replace("both", "two"), json]));
            expect(() => titleRows([unnamed], sets)).toThrow("two.json makes 2 sets, so it needs a name");
            expect(() => titleRows([both], bothSets("CC0-1.0"))).toThrow("both.json's sets have different licences");
            expect(() => titleRows([game], new Map())).toThrow("game.json makes sets/game-main.json, which isn't in");
        });
    });

    describe("titlesMarkdown", () => {
        const rows = [
            {
                kind: "program",
                title: "Zalaga",
                from: "https://www.level7.org.uk/z.txt",
                licence: "LicenseRef-level7-educational",
            },
            { kind: "program", title: "arcadians", from: "https://github.com/a/b/tree/c", licence: "MIT" },
            { kind: "rom", title: "DFS", from: "https://github.com/x/y", licence: "MIT" },
            {
                kind: "system",
                title: "MOS",
                licence: "CC-BY-NC-4.0",
                covers: [
                    { title: "MOS 1.20", from: "https://example.com/mos120.html" },
                    { title: "MOS 0.10", from: "https://example.com/mos010.html" },
                ],
            },
        ];

        it("lists each kind under its heading, sorted, linking where each set's names come from", () => {
            expect(titlesMarkdown(rows)).toContain(
                [
                    "## Programs",
                    "",
                    "- **arcadians**, names from [a/b](<https://github.com/a/b/tree/c>) (MIT)",
                    "- **Zalaga**, names from [level7.org.uk](<https://www.level7.org.uk/z.txt>) (level7-educational)",
                    "",
                    "## Sideways ROMs",
                    "",
                    "- **DFS**, names from [x/y](<https://github.com/x/y>) (MIT)",
                    "",
                    "## Operating systems",
                    "",
                    "- **MOS** (CC-BY-NC-4.0)",
                    "  - MOS 1.20, names from [example.com](<https://example.com/mos120.html>)",
                    "  - MOS 0.10, names from [example.com](<https://example.com/mos010.html>)",
                ].join("\n"),
            );
        });

        it("leaves out a kind with no titles", () => {
            expect(titlesMarkdown(rows.filter(({ kind }) => kind !== "rom"))).not.toContain("## Sideways ROMs");
        });

        it("escapes what Markdown would read in a title or a link's text", () => {
            const odd = {
                kind: "program",
                title: "Frak! *[x]_y_ ~~z~~ <b> &copy;",
                from: "https://github.com/_o_/r",
                licence: "MIT",
            };
            expect(titlesMarkdown([odd])).toContain(
                "- **Frak! \\*\\[x\\]\\_y\\_ \\~\\~z\\~\\~ \\<b> &amp;copy;**, names from [\\_o\\_/r](<https://github.com/_o_/r>) (MIT)",
            );
        });
    });

    describe("the shipped list", () => {
        it("lists every config's sets, each once", () => {
            const files = readConfigs(SymbolsDir).flatMap(({ config }) => setFilesOf(config));
            expect(files.sort()).toEqual(readSets().map(({ file }) => file));
        });

        it("is what the configs and sets make", async () => {
            const sets = new Map(readSets().map(({ file, json }) => [file, json]));
            const file = path.join(SymbolsDir, TitlesFile);
            const made = await formatText(titlesMarkdown(titleRows(readConfigs(SymbolsDir), sets)), file);
            expect(readFileSync(file, "utf8")).toBe(made);
        });
    });
});
