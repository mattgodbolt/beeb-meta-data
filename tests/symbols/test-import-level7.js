import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkSet } from "../../tools/symbols/build-index.js";
import {
    importLevel7,
    level7Text,
    noteMoves,
    partCalled,
    permissionOf,
    textFragment,
} from "../../tools/symbols/import-level7.js";
import { readLevel7 } from "../../tools/symbols/level7-text.js";

const Permission =
    "The author of this disassembly imposes no additional copyright restrictions beyond those already present on the game itself. It is provided for educational purposes only.";

// A game at &1900 that copies its last page to &0900, with a loader part that also runs at &1900.
const Text = `Game disassembly
================
Notes mention code_address once, and the table
&1912 is where it lives.

The author of this disassembly imposes no additional copyright restrictions
beyond those already present on the game itself. It is provided for educational
purposes only.

Loader disassembly
==================
; LOAD
; 001900 001900 000008

; loader_start
&1900 a2 ff    LDX #&ff
&1902 9a       TXS
&1903 4c 00 19 JMP &1900 ; loader_start

Game disassembly
================
; GAME
; 001900 001900 000020

; entry_point
&1900 a9 13    LDA #&13
&1902 85 8f    STA &8f ; code_address
&1904 a6 70    LDX &70 ; counter
&1906 a5 70    LDA &70 ; other_counter
&1908 86 70    STX &70 ; counter
&190a 20 0c 19 JSR &190c ; draw
; draw_entry
; draw
&190d e6 71    INC &71 ; frame
; unused
&190f 00 00 00
; table
&1912 12 34 56 78 9a bc
&1918 ea       NOP

# &1919 - &191e is copied to &0900 - &0905 at &1906

; moved_routine
&0900 a9 01    LDA #&01
&0902 8d 10 0a STA &0a10 ; workspace
&0905 8d 40 fe STA &fe40 ; via
&0908 a5 72    LDA &72 ; pair
&090a a5 73    LDA &73 ; pair
&090c 60       RTS
`;

const config = {
    importer: "level7",
    id: "test",
    licence: "LicenseRef-level7-educational",
    source: { disassembly: "https://www.example.com/miscellany/test-disassembly.txt", sha256: "0" },
    bytesPerAnchor: 2048,
    spreadAnchors: 4,
    sets: [
        {
            id: "game",
            title: "Test",
            part: "GAME",
            regions: [
                { name: "main", from: "entry_point", to: "&1919" },
                { name: "low", from: "moved_routine", to: "&090D" },
            ],
        },
    ],
};

describe("permissionOf", () => {
    it("finds the author's paragraph, whatever its line breaks", () => {
        expect(permissionOf(Text)).toBe(Permission);
    });

    it("refuses a disassembly without it", () => {
        expect(() => permissionOf("Game disassembly\n")).toThrow("doesn't say what its author allows");
    });
});

describe("noteMoves", () => {
    it("takes the copying instruction from each note", () => {
        expect(noteMoves(Text)).toEqual([0x1906]);
    });
});

describe("textFragment", () => {
    const text = "&1000 20 00 20 JSR &2000 ; draw  # Calls it\n&1003 60\n\n; draw  # Plots it\n&2000 60\n";
    const lower = text.toLowerCase();

    it("uses the name alone where that's the first match", () => {
        expect(textFragment(text, lower, "JSR", text.indexOf("JSR"))).toBe(":~:text=JSR");
    });

    it("adds the words after the name until only the label matches first", () => {
        expect(textFragment(text, lower, "draw", text.lastIndexOf("; draw ") + 2)).toBe(":~:text=draw,-%23%20Plots");
    });

    it("takes the next line's first word when the name ends its line", () => {
        const bare = text.replaceAll(/ {2}# \w+ it/g, "");
        expect(textFragment(bare, bare.toLowerCase(), "draw", bare.lastIndexOf("; draw\n") + 2)).toBe(
            ":~:text=draw,-%262000",
        );
    });

    it("gives up when nothing tells the place apart", () => {
        const twice = "; draw\n&2000\n; draw\n&2000\n";
        expect(textFragment(twice, twice, "draw", twice.lastIndexOf("draw"))).toBeUndefined();
    });
});

describe("importLevel7", () => {
    const imported = importLevel7(config, Text, { systemGlobals: new Map([[0x71, "os_frame"]]) });
    const [set] = imported.sets;

    it("makes a set the index accepts", () => {
        expect(imported.errors).toEqual([]);
        expect(checkSet(set.json, { file: "sets/test-game.json", mosSets: [] })).toEqual([]);
    });

    it("names each region's labels, leaving out a name the set can't keep", () => {
        expect(set.json.regions.main.symbols).toEqual({
            entry_point: "0x1900",
            draw: "0x190d",
            unused: "0x190f",
            table: "0x1912",
        });
        expect(set.json.regions.low.symbols).toEqual({ moved_routine: "0x0900" });
        expect(set.dropped).toContainEqual(["draw_entry", 0x190d, "main calls it draw"]);
    });

    it("takes globals from the set's own operands, the most used name for an address", () => {
        expect(set.json.globals).toEqual({ counter: "0x0070", code_address: "0x008f", workspace: "0x0a10" });
        expect(set.dropped).toContainEqual(["other_counter", 0x70, "the globals call it counter"]);
        expect(set.dropped).toContainEqual(["frame", 0x71, "the system sets call it os_frame"]);
        expect(set.dropped).toContainEqual(["pair", 0x72, "it names 2 addresses as often"]);
        expect(set.json.globals.via).toBeUndefined();
    });

    it("keeps anchors off padding, and tells the loader at the same address apart", () => {
        const anchors = Object.values(set.json.regions).flatMap((region) => region.anchors);
        expect(anchors.every(({ at }) => at !== "0x190f")).toBe(true);
        expect(set.json.regions.low.anchors.length).toBeGreaterThan(0);
        const loader = new Map([0xa2, 0xff, 0x9a, 0x4c, 0x00, 0x19].map((byte, i) => [0x1900 + i, byte]));
        const held = ({ at, bytes }) =>
            Buffer.from(bytes, "hex").every((byte, i) => loader.get(parseInt(at, 16) + i) === byte);
        expect(set.json.regions.main.anchors.length).toBeGreaterThan(0);
        expect(set.json.regions.main.anchors.every(held)).toBe(false);
    });

    it("takes a note's copying instruction as a move when it's a store", () => {
        const stored = (text) =>
            importLevel7(config, text, { systemGlobals: new Map() }).reasons.some((reason) =>
                reason.includes("matches no store"),
            );
        expect(stored(Text)).toBe(true);
        expect(stored(Text.replace("is copied to &0900 - &0905 at &1906", "is copied to &0900 - &0905 at &1908"))).toBe(
            false,
        );
    });

    it("links names to their lines with text fragments, and quotes the author's permission", () => {
        expect(set.json.nameLink).toBe("https://www.example.com/miscellany/{place}");
        expect(set.json.places.draw).toBe("test-disassembly.txt#:~:text=draw,-%26190d");
        expect(set.json.places.code_address).toBe("test-disassembly.txt#:~:text=code_address,-%261904");
        expect(set.json.places.table).toBe("test-disassembly.txt#:~:text=%261912,-12");
        expect(set.json.notice).toContain(Permission);
        expect(set.json.licence).toBe("LicenseRef-level7-educational");
    });

    it("leaves out statements that disagree at an address, and the pieces a region says to", () => {
        const typo = Text.replace("&1918 ea       NOP", "&1918 ea       NOP\n; stray_label\n&1912 ff");
        const noted = importLevel7(config, typo, { systemGlobals: new Map() });
        expect(noted.notes.some((note) => note.includes("disagree with others at the same address"))).toBe(true);
        expect(noted.sets[0].json.regions.main.symbols.table).toBeUndefined();
        expect(noted.sets[0].json.regions.main.symbols.stray_label).toBeUndefined();

        const unrelocated = Text.replace("; moved_routine", "; tape_name\n&1918 54 41 50 45\n\n; moved_routine");
        const spec = config.sets[0];
        const leaving = {
            ...config,
            sets: [{ ...spec, regions: [{ ...spec.regions[0], leaveOut: ["&1918"] }, spec.regions[1]] }],
        };
        const left = importLevel7(leaving, unrelocated, { systemGlobals: new Map() });
        expect(left.notes.some((note) => note.includes("disagree"))).toBe(false);
        expect(left.sets[0].json.regions.main.symbols.tape_name).toBeUndefined();
    });

    it("keeps code, and any labelled statement, where a data row repeats the same bytes", () => {
        const rows = Text.replace("; draw_entry\n", "&190b 0c 19 e6 71\n; draw_entry\n").replace(
            "&1918 ea       NOP",
            "&1918 ea       NOP\n; also_table\n&1912 12 34",
        );
        const kept = importLevel7(config, rows, { systemGlobals: new Map() });
        expect(kept.notes.some((note) => note.includes("disagree"))).toBe(false);
        const { symbols } = kept.sets[0].json.regions.main;
        expect(symbols.draw).toBe("0x190d");
        expect(symbols.also_table).toBe("0x1912");
    });

    it("refuses a leaveOut outside its region, and a region whose statements all disagree", () => {
        const spec = config.sets[0];
        const outside = { ...config, sets: [{ ...spec, regions: [{ ...spec.regions[0], leaveOut: ["&0900"] }] }] };
        expect(() => importLevel7(outside, Text, { systemGlobals: new Map() })).toThrow("which leaveOut names");
        const clash = Text.replace("&1918 ea       NOP", "&1918 ea       NOP\n&1912 ff\n&1913 ff ff ff ff ff");
        const only = { ...config, sets: [{ ...spec, regions: [{ name: "table", from: "&1912", to: "&1918" }] }] };
        expect(() => importLevel7(only, clash, { systemGlobals: new Map() })).toThrow("disagrees with another");
    });

    it("needs a part when two have statements in a region", () => {
        const loose = {
            ...config,
            sets: [{ ...config.sets[0], part: undefined, regions: [config.sets[0].regions[0]] }],
        };
        const lone = {
            ...loose,
            sets: [{ ...loose.sets[0], regions: [{ name: "main", from: "&1900", to: "&1908" }] }],
        };
        expect(() => importLevel7(lone, Text, { systemGlobals: new Map() })).toThrow("give its part");
    });

    it("takes a part by its heading and name where two files have the same name", () => {
        const twice = Text.replace("; LOAD", "; GAME");
        const game = readLevel7(twice).parts.find((part) => part.heading === "Game disassembly");
        expect(partCalled(readLevel7(twice).parts, game)).toBe("Game disassembly/GAME");
        expect(() => importLevel7(config, twice, { systemGlobals: new Map() })).toThrow("2 parts");
        const qualified = { ...config, sets: [{ ...config.sets[0], part: "Game disassembly/GAME" }] };
        expect(importLevel7(qualified, twice, { systemGlobals: new Map() }).sets[0].regions[0].start).toBe(0x1900);
    });

    it("refuses regions that overlap", () => {
        const regions = [
            { name: "main", from: "entry_point", to: "&1919" },
            { name: "table", from: "&1912", to: "&1918" },
        ];
        const both = { ...config, sets: [{ ...config.sets[0], regions }] };
        expect(() => importLevel7(both, Text, { systemGlobals: new Map() })).toThrow(
            "game/main and game/table overlap",
        );
    });
});

describe("level7Text", () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "level7-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("reads a copy only if its hash is the config's", async () => {
        const file = path.join(dir, "test.txt");
        writeFileSync(file, Text);
        const sha256 = createHash("sha256").update(Text).digest("hex");
        await expect(level7Text({ source: { ...config.source, sha256 } }, file)).resolves.toBe(Text);
        await expect(level7Text(config, file)).rejects.toThrow("the config pins 0");
    });
});
