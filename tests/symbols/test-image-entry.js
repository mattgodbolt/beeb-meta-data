import { describe, expect, it } from "vitest";

import { fingerprint } from "../../tools/registry/fingerprint.js";
import { corpusRef, imageEntries, publishedUrl, showAddress } from "../../tools/symbols/image-entry.js";

const SectorSize = 256;
const SectorsPerTrack = 10;
const Tracks = 80;
const SideBytes = Tracks * SectorsPerTrack * SectorSize;

/** One DFS side holding `$.<name>`, one sector long, loading at `load` and running at `exec`. */
function side(name, load, exec) {
    const bytes = new Uint8Array(SideBytes);
    bytes.set(new TextEncoder().encode(`${name.padEnd(7)}$`), 8);
    bytes.set([8, ((Tracks * SectorsPerTrack) >> 8) & 3, (Tracks * SectorsPerTrack) & 0xff], SectorSize + 5);
    const mixed = (((load >> 16) & 3) << 2) | (((exec >> 16) & 3) << 6);
    bytes.set([load & 0xff, (load >> 8) & 0xff, exec & 0xff, (exec >> 8) & 0xff, 0, 1, mixed, 2], SectorSize + 8);
    bytes.fill(0xa9, 2 * SectorSize, 3 * SectorSize);
    return bytes;
}

/** Two sides as a DSD interleaves them, a track of each in turn. */
function dsd(first, second) {
    const trackBytes = SectorsPerTrack * SectorSize;
    const bytes = new Uint8Array(2 * SideBytes);
    for (let track = 0; track < Tracks; track++) {
        bytes.set(first.subarray(track * trackBytes, (track + 1) * trackBytes), 2 * track * trackBytes);
        bytes.set(second.subarray(track * trackBytes, (track + 1) * trackBytes), (2 * track + 1) * trackBytes);
    }
    return bytes;
}

describe("image-entry", () => {
    it("publishes a corpus path at its mirror's URL, and gives none for any other path", () => {
        expect(publishedUrl("sth-disc/AnF/Chuckie Egg.zip")).toBe(
            "https://bbc.xania.org/archive/sth/diskimages/AnF/Chuckie%20Egg.zip",
        );
        expect(publishedUrl("sth-tape/Robico/Hunt.zip")).toBe(
            "https://bbc.xania.org/archive/sth/tapeimages/Robico/Hunt.zip",
        );
        expect(publishedUrl("chuckie-egg-2.ssd")).toBeNull();
    });

    it("finds the corpus path in a path written out in full", () => {
        expect(corpusRef("/home/me/repo/.registry-corpus/sth-disc/AnF/ChuckieEgg.zip")).toBe(
            "sth-disc/AnF/ChuckieEgg.zip",
        );
        expect(corpusRef("build/chuckie-egg-2.ssd")).toBeNull();
    });

    it("shows a host address as &FFFF and an ordinary one as it is", () => {
        expect(showAddress(0x31900)).toBe("&FFFF1900");
        expect(showAddress(0xffff0e00)).toBe("&FFFF0E00");
        expect(showAddress(0x1100)).toBe("&1100");
    });

    it("gives a disc's entry with the key the in-memory check computes, and its files", () => {
        const game = side("GAME", 0x31100, 0x31200);
        const [entry, ...rest] = imageEntries("https://example.com/g.zip", {
            "G/Game.ssd": game,
            README: new Uint8Array(1),
        });
        expect(rest).toEqual([]);
        expect(entry).toMatchObject({
            kind: "disc",
            entry: {
                url: "https://example.com/g.zip",
                image: "G/Game.ssd",
                key: fingerprint("G/Game.ssd", game).discKey,
            },
        });
        expect(entry.sides).toMatchObject([[{ name: "$.GAME", load: 0x31100, exec: 0x31200, length: 0x100 }]]);
    });

    it("lists a double-sided disc's files by side", () => {
        const [{ sides }] = imageEntries(null, {
            "Two.dsd": dsd(side("FRONT", 0x1100, 0x1100), side("BACK", 0x2000, 0x2000)),
        });
        expect(sides.map((files) => files.map(({ name }) => name))).toEqual([["$.FRONT"], ["$.BACK"]]);
    });
});
