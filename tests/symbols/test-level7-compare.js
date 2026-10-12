import { describe, expect, it } from "vitest";

import {
    compareWithMemory,
    differingSpans,
    draftCheck,
    draftConfig,
    inGameLabel,
    proposeRegions,
} from "../../tools/symbols/level7-compare.js";
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
    `${labels.map((label) => `; ${label}\n`).join("")}&${address.toString(16)} ${"ea ".repeat(16).trim()}`;

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

    it("cuts a few bytes off a region that overlaps a bigger one at its end, rather than leaving it out", () => {
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
