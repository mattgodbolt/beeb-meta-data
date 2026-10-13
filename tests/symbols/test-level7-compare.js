import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createZipBlob } from "jsbeeb/src/archive.js";
import { decodeTape, tapeKey } from "../../tools/registry/tape.js";
import {
    compareWithMemory,
    differingSpans,
    draftCheck,
    draftConfig,
    inGameLabel,
    main,
    proposeRegions,
    sourceAndMedia,
} from "../../tools/symbols/level7-compare.js";
import { MasterBasicPage, basicLine, basicTape } from "../registry/tape-images.js";
import { hex } from "../../tools/symbols/import-level7.js";
import { readLevel7 } from "../../tools/symbols/level7-text.js";

const Text = `Game disassembly
================
&1900 a9 13    LDA #&13
#     actually LDA #&14
&1902 85 70    STA &70
&0900 60       RTS
&0901 01 02
`;

describe("compareWithMemory", () => {
    it("counts each run's bytes memory agrees with, leaving out those the program changes", () => {
        const memory = new Map([
            [0x1902, 0x85],
            [0x1903, 0x70],
            [0x0900, 0x60],
            [0x0901, 0xff],
            [0x0902, 0x02],
        ]);
        const [{ part, runs }] = compareWithMemory(readLevel7(Text).parts, (at) => memory.get(at));
        expect(part).toBe("Game disassembly");
        expect(runs).toEqual([
            { start: 0x1900, end: 0x1904, line: 3, held: 2, same: 2 },
            { start: 0x0900, end: 0x0903, line: 6, held: 3, same: 2 },
        ]);
    });
});

const statement = (address, labels) =>
    `${labels.map((label) => `; ${label}\n`).join("")}&${address.toString(16).padStart(4, "0")} ${"ea ".repeat(16).trim()}`;

// Code at &1000-&1400, a gap, more at &1480-&1500, a loader at &2000-&2100 and a lone label at &3000.
const Program = `Game disassembly
================
${[
    ...Array.from({ length: 0x40 }, (_, i) => statement(0x1000 + i * 16, i % 8 ? [] : [`code_${i}`])),
    ...Array.from({ length: 8 }, (_, i) => statement(0x1480 + i * 16, i ? [] : ["more", "more_too"])),
    ...Array.from({ length: 16 }, (_, i) => statement(0x2000 + i * 16, i % 8 ? [] : [`loader_${i}`])),
    ...Array.from({ length: 16 }, (_, i) => statement(0x3000 + i * 16, i ? [] : ["lone"])),
].join("\n")}
`;

describe("proposeRegions", () => {
    const { parts } = readLevel7(Program);
    const memoryWith = (ranges) => (at) => (ranges.some(([from, to]) => at >= from && at < to) ? 0xea : 0);
    const loaded = compareWithMemory(
        parts,
        memoryWith([
            [0x2000, 0x2100],
            [0x3000, 0x3100],
        ]),
    );
    const playing = compareWithMemory(
        parts,
        memoryWith([
            [0x1000, 0x1500],
            [0x3000, 0x3100],
        ]),
    );

    it("makes one region of nearby runs held at the same moments, and says when each is held", () => {
        const regions = proposeRegions(parts, [loaded, playing]);
        expect(regions.map(({ name, from, to, heldAt }) => ({ name, from, to, heldAt }))).toEqual([
            { name: "main", from: "&1000", to: "&1500", heldAt: [false, true] },
            { name: "page20", from: "&2000", to: "&2100", heldAt: [true, false] },
        ]);
    });

    it("leaves out a region with fewer than two labels", () => {
        expect(proposeRegions(parts, [loaded, playing]).some((r) => r.from === "&3000")).toBe(false);
    });

    const run = (address, count, prefix) =>
        Array.from({ length: count }, (_, i) => statement(address + i * 16, i % 2 ? [] : [`${prefix}_${i}`]));
    const heading = (name) => `${name}\n${"=".repeat(name.length)}`;
    const held = (text) => {
        const { parts: theirs } = readLevel7(text);
        const all = compareWithMemory(theirs, () => 0xea);
        return { parts: theirs, regions: proposeRegions(theirs, [all]) };
    };

    it("leaves out a small region, and one in zero page", () => {
        const { regions } = held(`${heading("Game")}
${[...run(0x1000, 0x40, "code"), ...run(0x2000, 4, "small"), ...run(0x0050, 0x10, "zp")].join("\n")}
`);
        expect(regions.map((r) => r.from)).toEqual(["&1000"]);
    });

    it("drops the smaller of two that overlap, and gives a region its part where another part has statements", () => {
        const { regions } = held(`${heading("Game")}
${run(0x1000, 0x40, "code").join("\n")}
${heading("Loader")}
${run(0x1200, 0x10, "loader").join("\n")}
`);
        expect(regions.map(({ name, part, from, to }) => ({ name, part, from, to }))).toEqual([
            { name: "main", part: "Game", from: "&1000", to: "&1400" },
        ]);
    });

    it("cuts a few bytes off a region that overlaps a bigger one at its start, rather than leaving it out", () => {
        const { regions } = held(`${heading("Game")}
${run(0x1000, 0x40, "code").join("\n")}
${heading("Loader")}
${run(0x13e0, 0x20, "loader").join("\n")}
`);
        expect(regions.map(({ name, part, from, to }) => ({ name, part, from, to }))).toEqual([
            { name: "main", part: "Game", from: "&1000", to: "&1400" },
            { name: "page14", part: undefined, from: "&1400", to: "&15E0" },
        ]);
    });

    it("cuts a few bytes off a region that overlaps a bigger one at its end", () => {
        const { regions } = held(`${heading("Game")}
${run(0x1000, 0x40, "code").join("\n")}
${heading("Loader")}
${run(0x0f00, 0x12, "loader").join("\n")}
`);
        expect(regions.map(({ name, from, to }) => ({ name, from, to }))).toEqual([
            { name: "main", from: "&1000", to: "&1400" },
            { name: "pagef", from: "&0F00", to: "&1000" },
        ]);
    });
});

describe("draftConfig", () => {
    it("marks overwritten only what's held before the keys and not after", () => {
        const region = (name, heldAt) => ({ name, from: "&1000", to: "&1100", heldAt, avoid: [] });
        const config = { source: {}, disc: {} };
        const regions = [region("loader", [true, false]), region("main", [false, true]), region("both", [true, true])];
        const [set] = draftConfig("test", "Test", config, regions).sets;
        expect(set.regions.map((r) => [r.name, r.overwritten ?? false])).toEqual([
            ["loader", true],
            ["main", false],
            ["both", false],
        ]);
    });
});

describe("draftCheck", () => {
    it("names the model a scenario wants, when there is one", () => {
        const options = { seconds: 10, keys: ["SPACE:2"], inGame: ["game", "main", "loop"] };
        expect(draftCheck("Test", [], options)).not.toContain("machines");
        expect(draftCheck("Test", [], { ...options, model: "Master" })).toContain(
            'export const machines = { game: { model: "Master" } };',
        );
    });
});

describe("inGameLabel", () => {
    const regions = [
        { name: "main", heldAt: [false, true] },
        { name: "title", heldAt: [true, false] },
    ];
    const setNaming = (main, title = []) => ({
        regions: [
            { name: "main", symbols: new Map(main.map((name) => [name, 0])) },
            { name: "title", symbols: new Map(title.map((name) => [name, 0])) },
        ],
    });
    const hot = [{ name: "plot_sprite" }, { name: "move_enemy" }];
    const regionOf = () => regions[0];

    it("prefers update_player, then main_game_loop, in a region held in a game", () => {
        const all = setNaming(["main_game_loop", "update_player", "plot_sprite"]);
        expect(inGameLabel(all, regions, hot, regionOf)).toEqual(["game", "main", "update_player"]);
        const loop = setNaming(["main_game_loop", "plot_sprite"], ["update_player"]);
        expect(inGameLabel(loop, regions, hot, regionOf)).toEqual(["game", "main", "main_game_loop"]);
    });

    it("else takes the first routine hot only after the keys that the set keeps", () => {
        expect(inGameLabel(setNaming(["move_enemy"]), regions, hot, regionOf)).toEqual(["game", "main", "move_enemy"]);
        expect(inGameLabel(setNaming([]), regions, hot, regionOf)).toBeUndefined();
    });
});

describe("differingSpans", () => {
    it("avoids the bytes memory disagrees with while the region is held, as ranges", () => {
        const [part] = readLevel7(Program).parts;
        const memory = new Uint8Array(0x8000).fill(0xea);
        memory.fill(0, 0x1004, 0x1006);
        memory.fill(0, 0x1010, 0x1011);
        memory.fill(0, 0x1100, 0x1102);
        const region = { of: part, start: 0x1000, end: 0x1400, heldAt: [false, true] };
        const unheld = new Uint8Array(0x8000);
        expect(differingSpans(region, [{ memory: unheld }, { memory }])).toEqual([
            ["&1004", "&1011"],
            ["&1100", "&1102"],
        ]);
    });
});

describe("main", () => {
    const Program = "?&900=&42:REM a program of more than sixteen bytes";
    const tape = basicTape(Program);
    const listingOf = (program, more = "") => `Game disassembly
================
; program
&${MasterBasicPage.toString(16).padStart(4, "0")} ${basicLine(program)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(" ")}
${more}`;
    const listing = listingOf(Program);
    let temp;

    afterEach(() => {
        vi.restoreAllMocks();
        if (temp) rmSync(temp, { recursive: true, force: true });
    });

    const configWithTape = (program = Program, text = listing) => {
        const programTape = basicTape(program);
        temp = mkdtempSync(path.join(tmpdir(), "level7-compare-test-"));
        const source = path.join(temp, "listing.txt");
        writeFileSync(source, text);
        const config = path.join(temp, "config.json");
        writeFileSync(
            config,
            JSON.stringify({
                id: "hopper",
                source: {
                    disassembly: "https://example.com/listing.txt",
                    sha256: createHash("sha256").update(text).digest("hex"),
                },
                tape: {
                    url: "https://example.com/prog.zip",
                    image: "prog.uef",
                    key: tapeKey(decodeTape(programTape).files),
                },
                sets: [{ id: "game" }],
            }),
        );
        vi.spyOn(globalThis, "fetch").mockImplementation(
            async () => new Response(createZipBlob([{ name: "prog.uef", data: programTape }])),
        );
        return ["--config", config, "--source", source];
    };

    it(
        "boots a config's tape on the model asked for, runs a script, and reports each moment",
        { timeout: 60000 },
        async () => {
            const log = vi.spyOn(console, "log").mockImplementation(() => {});
            const args = [...configWithTape(), "--model", "Master", "--seconds", "20", "--script", "wait 1; report"];
            expect(await main(args)).toBe(0);
            const printed = log.mock.calls.map(([line]) => line);
            expect(printed.filter((line) => /^After/.test(line))).toHaveLength(2);
            expect(printed).toContain(
                `    ${hex(MasterBasicPage)}-${hex(MasterBasicPage + basicLine(Program).length - 1)} (line 4): 100%`,
            );
        },
    );

    it("reads a Master's shadow RAM with --shadow, and main RAM without", { timeout: 60000 }, async () => {
        // ACCCON at BASIC's prompt is &18; &1C adds X, putting shadow RAM at &3000 for the program's stores.
        const shadowWriter =
            "?&FE34=&1C:!&3000=&04030201:!&3004=&08070605:!&3008=&0C0B0A09:!&300C=&100F0E0D:?&FE34=&18";
        const text = listingOf(shadowWriter, "; table\n&3000 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10\n");
        const tableHeld = async (extra) => {
            const log = vi.spyOn(console, "log").mockImplementation(() => {});
            const args = [...configWithTape(shadowWriter, text), "--model", "Master", "--seconds", "20", ...extra];
            await main(args);
            const line = log.mock.calls.map(([printed]) => printed).find((l) => /^\s+&3000-&300F/.test(l));
            log.mockRestore();
            rmSync(temp, { recursive: true, force: true });
            return line?.match(/(\d+)%$/)[1];
        };
        expect(await tableHeld(["--shadow"])).toBe("100");
        expect(await tableHeld([])).toBe("0");
    });

    it("refuses --shadow on a machine without it, on a model it doesn't know, and in a draft, before fetching", async () => {
        const args = configWithTape();
        await expect(main([...args, "--shadow"])).rejects.toThrow("--shadow needs a Master");
        await expect(main([...args, "--shadow", "--model", "Mastr"])).rejects.toThrow("isn't a jsbeeb model");
        const draft = ["--keys", "SPACE", "--model", "Master", "--shadow", "--draft", "test"];
        await expect(main([...args, ...draft])).rejects.toThrow("--draft can't use --shadow");
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("refuses a config with nothing to boot, and --boot-tape without a config", async () => {
        const [, config, ...rest] = configWithTape();
        const { tape: _, ...bare } = JSON.parse(readFileSync(config, "utf8"));
        writeFileSync(config, JSON.stringify(bare));
        await expect(main(["--config", config, ...rest])).rejects.toThrow("names no disc or tape to boot");
        await expect(main(["--boot-tape", "--disassembly", "x", "--tape", "y"])).rejects.toThrow("--boot-tape picks");
    });

    it("fetches a --tape from its mirror with each part of its path encoded", async () => {
        const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(async (url) =>
                url.endsWith(".txt")
                    ? new Response(listing)
                    : new Response(createZipBlob([{ name: "prog.uef", data: tape }])),
            );
        const { config } = await sourceAndMedia({ disassembly: "https://example.com/l.txt", tape: "Some Pub/A Game" });
        const url = "https://bbc.xania.org/archive/sth/tapeimages/Some%20Pub/A%20Game.zip";
        expect(fetch).toHaveBeenCalledWith(url);
        expect(config.tape.url).toBe(url);
    });

    it("refuses to draft from a script", async () => {
        await expect(main([...configWithTape(), "--script", "report", "--draft", "test"])).rejects.toThrow(
            "--draft needs --keys",
        );
    });
});
