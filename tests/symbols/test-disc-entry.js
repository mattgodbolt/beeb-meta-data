import { describe, expect, it } from "vitest";

import { discEntries, publishedUrl } from "../../tools/symbols/disc-entry.js";

const SectorSize = 256;
const SectorsPerSide = 800;

/** A single-sided DFS image holding one file, `$.GAME`, loading at &1100 and running at &1200. */
function ssd() {
    const disc = new Uint8Array(SectorsPerSide * SectorSize);
    disc.set(new TextEncoder().encode("GAME   $"), 8);
    disc.set([8, (SectorsPerSide >> 8) & 3, SectorsPerSide & 0xff], SectorSize + 5);
    disc.set([0x00, 0x11, 0x00, 0x12, 0x00, 0x01, 0x00, 2], SectorSize + 8);
    disc.fill(0xa9, 2 * SectorSize, 3 * SectorSize);
    return disc;
}

describe("disc-entry", () => {
    it("publishes a corpus path at its mirror's URL, and refuses one under no mirror", () => {
        expect(publishedUrl("sth-disc/AnF/Chuckie Egg.zip")).toBe(
            "https://bbc.xania.org/archive/sth/diskimages/AnF/Chuckie%20Egg.zip",
        );
        expect(() => publishedUrl("hfe/x.hfe")).toThrow("isn't a file under sth-disc");
    });

    it("gives each disc image's entry, with its key, and its files", () => {
        const [entry, ...rest] = discEntries("https://example.com/g.zip", {
            "G/Game.ssd": ssd(),
            README: new Uint8Array(1),
        });
        expect(rest).toEqual([]);
        expect(entry.disc).toMatchObject({ url: "https://example.com/g.zip", image: "G/Game.ssd" });
        expect(entry.disc.key).toMatch(/^[0-9a-f]{32}$/);
        expect(entry.files).toMatchObject([{ name: "$.GAME", load: 0x1100, exec: 0x1200, length: 0x100 }]);
    });
});
