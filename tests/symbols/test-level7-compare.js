import { describe, expect, it } from "vitest";

import { compareWithMemory } from "../../tools/symbols/level7-compare.js";
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
