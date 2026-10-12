import { describe, expect, it } from "vitest";

import { compareWithMemory, differingSpans, proposeRegions } from "../../tools/symbols/level7-compare.js";
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
