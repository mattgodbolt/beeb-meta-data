import { describe, expect, it } from "vitest";

import { instructionLength, readLevel7 } from "../../tools/symbols/level7-text.js";

const Text = `Game disassembly
================
; GAME
; 001900 001900 000100

; entry_point                                                       # Called once
&1900 a9 13    LDA #&13
#     actually LDA #&14
&1902 85 8f    STA &8f ; code_address_high
#     or       STA &90 ; code_address_high if MOS 0.10
&1904 91 70    STA (&70),Y ; target_address                         # Write it
&1906 ad 00 30 LDA &3000 ; screen_memory + 1
; loop (LOOP)
&1909 d0 fe    BNE &1909 ; loop
&190b e8       INX if X was negative
&190c 8d 01    STA &0201
; table
;      0  1  2
&190e 01 02 03                                        ; &00

# &1911 - &1912 is copied to &0900 - &0901 at &1906
; moved
&0900 60       RTS
`;

describe("instructionLength", () => {
    it("reads the length from how the operand is written", () => {
        expect(instructionLength("RTS", "")).toBe(1);
        expect(instructionLength("ROR", "A")).toBe(1);
        expect(instructionLength("INX", "if X was negative")).toBe(1);
        expect(instructionLength("LDA", "#&13")).toBe(2);
        expect(instructionLength("BNE", "&1909")).toBe(2);
        expect(instructionLength("STA", "(&70),Y")).toBe(2);
        expect(instructionLength("JMP", "(&021e)")).toBe(3);
        expect(instructionLength("STA", "&0201")).toBe(3);
        expect(instructionLength("JSR", "&....")).toBeUndefined();
    });
});

describe("readLevel7", () => {
    const { parts, references, doubtful } = readLevel7(Text);
    const [part] = parts;

    it("starts a part at a file's header, named by the line before it", () => {
        expect(parts).toHaveLength(1);
        expect(part.name).toBe("GAME");
        expect(part.heading).toBe("Game disassembly");
        expect(part.file).toEqual({ name: "GAME", load: 0x1900, exec: 0x1900, length: 0x100 });
    });

    it("reads each statement's address, bytes and whether it's an instruction", () => {
        expect(part.statements.map(({ address, data, code }) => [address, data, code])).toEqual([
            [0x1900, [0xa9, 0x13], true],
            [0x1902, [0x85, 0x8f], true],
            [0x1904, [0x91, 0x70], true],
            [0x1906, [0xad, 0x00, 0x30], true],
            [0x1909, [0xd0, 0xfe], true],
            [0x190b, [0xe8], true],
            [0x190c, [0x8d, 0x01], false],
            [0x190e, [0x01, 0x02, 0x03], false],
            [0x0900, [0x60], true],
        ]);
        expect(part.statements[1].base).toBe(0x8f);
    });

    it("marks an instruction the disassembly says runs as something else (`actually`, `or`)", () => {
        expect(part.statements.filter((s) => s.modified).map((s) => s.address)).toEqual([0x1900, 0x1902]);
    });

    it("gives each label the address of the statement after it", () => {
        expect(part.labels.map(({ name, address, line }) => [name, address, line])).toEqual([
            ["entry_point", 0x1900, 6],
            ["loop", 0x1909, 13],
            ["table", 0x190e, 17],
            ["moved", 0x0900, 22],
        ]);
    });

    it("takes an operand's name only when it's a name alone", () => {
        expect(references.map(({ name, address }) => [name, address])).toEqual([
            ["code_address_high", 0x8f],
            ["target_address", 0x70],
        ]);
    });

    it("reads an instruction whose bytes its operand disagrees with as data, and says so", () => {
        expect(doubtful).toEqual(["line 16: STA &0201 is 3 bytes, not 2"]);
    });
});
