import { describe, expect, it } from "vitest";

import { romCopies, romImages } from "../../tools/symbols/rom-images.js";

const Size = 0x40;

describe("romImages", () => {
    it("places every bank where the ROM runs", () => {
        const bytes = Uint8Array.from({ length: Size * 2 }, (_, i) => i);
        const images = romImages([{ name: "two.rom", bytes }], 0x8000, Size);
        expect(images.map(({ name }) => name)).toEqual(["two.rom bank 0", "two.rom bank 1"]);
        expect(images[1].memory.get(0x8000)).toBe(Size);
    });
});

describe("romCopies", () => {
    const code = [0xa9, 0x01, 0x8d, 0x00, 0x30, 0xa2, 0x05, 0xca, 0xd0, 0xfd, 0x60, 0x48, 0x68, 0x40];
    const moved = new Map(code.map((byte, i) => [0x0d00 + i, byte]));

    it("places another ROM's copy of moved code where the code runs, differences and all", () => {
        const bytes = new Uint8Array(Size);
        bytes.set(code, 0x20);
        bytes[0x20 + 12] = 0xea;
        const [copy] = romCopies([{ name: "other.rom", bytes }], Size, moved);
        expect(copy.name).toBe("other.rom's copy");
        expect([...copy.memory]).toEqual(code.map((byte, i) => [0x0d00 + i, i === 12 ? 0xea : byte]));
    });

    it("finds no copy in a bank that shares no run of the code", () => {
        expect(romCopies([{ name: "blank.rom", bytes: new Uint8Array(Size) }], Size, moved)).toEqual([]);
    });
});
