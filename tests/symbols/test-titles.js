import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readSets, SymbolsDir } from "../../tools/symbols/build-index.js";
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
            expect(kindOf([set("MOS", [["0xc000", "0x10000"]], { system: true })])).toBe("system");
        });

        it("calls a title with code in &8000-&BFFF a sideways ROM, even with some in RAM", () => {
            expect(kindOf([set("DFS", [["0x8000", "0xc000"]]), set("Tube host", [["0x0400", "0x0800"]])])).toBe("rom");
        });

        it("calls anything else a program", () => {
            expect(kindOf([set("Game", [["0x1900", "0x7c00"]])])).toBe("program");
        });
    });

    describe("titleRows", () => {
        const game = { name: "game.json", config: { id: "game", sets: [{ id: "main" }] } };

        it("names a one-set title after its set, linking its home over its source", () => {
            const sets = new Map([
                ["sets/game-main.json", set("Game", [["0x1900", "0x2000"]], { home: "https://example.com/" })],
            ]);
            expect(titleRows([game], sets)).toEqual([
                { kind: "program", title: "Game", covers: [], from: "https://example.com/", licence: "MIT" },
            ]);
        });

        it("names a title with several sets by its config's name, listing the sets", () => {
            const both = { name: "both.json", config: { id: "both", name: "Both", sets: [{ id: "a" }, { id: "b" }] } };
            const sets = new Map([
                ["sets/both-a.json", set("Both: A", [["0x1900", "0x2000"]])],
                ["sets/both-b.json", set("Both: B", [["0x3000", "0x3100"]])],
            ]);
            expect(titleRows([both], sets)[0]).toMatchObject({ title: "Both", covers: ["Both: A", "Both: B"] });
        });

        it("refuses a title with several sets and no name, or a set that isn't there", () => {
            const unnamed = { name: "two.json", config: { id: "two", sets: [{ id: "a" }, { id: "b" }] } };
            const sets = new Map([
                ["sets/two-a.json", set("A", [["0x1900", "0x2000"]])],
                ["sets/two-b.json", set("B", [["0x1900", "0x2000"]])],
            ]);
            expect(() => titleRows([unnamed], sets)).toThrow("two.json makes 2 sets, so it needs a name");
            expect(() => titleRows([game], new Map())).toThrow("game.json makes sets/game-main.json, which isn't in");
        });
    });

    it("lists each kind under its heading, sorted, with where the names come from", () => {
        const rows = [
            {
                kind: "program",
                title: "Zalaga",
                covers: [],
                from: "https://www.level7.org.uk/z.txt",
                licence: "LicenseRef-level7-educational",
            },
            { kind: "program", title: "arcadians", covers: [], from: "https://github.com/a/b/tree/c", licence: "MIT" },
            {
                kind: "system",
                title: "MOS",
                covers: ["MOS 1.20", "MOS 0.10"],
                from: "https://example.com/mos",
                licence: "CC-BY-NC-4.0",
            },
        ];
        const markdown = titlesMarkdown(rows);
        expect(markdown).toContain(
            [
                "## Programs",
                "",
                "- **arcadians**, names from [a/b](https://github.com/a/b/tree/c) (MIT)",
                "- **Zalaga**, names from [level7.org.uk](https://www.level7.org.uk/z.txt) (level7-educational)",
                "",
                "## Operating systems",
                "",
                "- **MOS**, names from [example.com](https://example.com/mos) (CC-BY-NC-4.0)",
                "  - MOS 1.20",
                "  - MOS 0.10",
            ].join("\n"),
        );
        expect(markdown).not.toContain("## Sideways ROMs");
    });

    describe("the shipped list", () => {
        it("lists every config's sets, each once", () => {
            const files = readConfigs().flatMap(({ config }) => setFilesOf(config));
            expect(files.sort()).toEqual(readSets().map(({ file }) => file));
        });

        it("is what the configs and sets make", async () => {
            const sets = new Map(readSets().map(({ file, json }) => [file, json]));
            const { format, resolveConfig } = await import("prettier");
            const file = path.join(SymbolsDir, TitlesFile);
            const options = await resolveConfig(file, { editorconfig: true });
            const made = await format(titlesMarkdown(titleRows(readConfigs(), sets)), { ...options, filepath: file });
            expect(readFileSync(file, "utf8")).toBe(made);
        });
    });
});
