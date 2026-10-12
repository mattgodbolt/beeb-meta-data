import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createZipBlob } from "jsbeeb/src/archive.js";
import { RomsDir } from "../../tools/jsbeeb.js";
import { fingerprint } from "../../tools/registry/fingerprint.js";
import { SymbolsDir } from "../../tools/symbols/build-index.js";
import {
    fetchDisc,
    fetchRom,
    loadSets,
    loadTitleSets,
    matchingRegions,
    overlappingRegions,
    romOf,
    startMachine,
    typeUntil,
} from "../../tools/symbols/check-memory.js";
import { romKey } from "../../tools/symbols/rom-images.js";
import { parseSet } from "jsbeeb/src/symbol-sets.js";

const set = (regions) => parseSet({ format: 1, title: "t", licence: "CC0-1.0", source: "s", regions });
const anchored = (start, end, at, bytes) => ({
    start,
    end,
    minAnchors: 1,
    anchors: [{ at, bytes }],
});

const sets = {
    loader: set({ main: anchored("0x0400", "0x043c", "0x0400", "a9008d01") }),
    cheat: set({
        decrypted: anchored("0x043b", "0x0500", "0x0440", "a2058e02"),
        far: anchored("0x2000", "0x2100", "0x2000", "deadbeef"),
        tail: anchored("0x20ff", "0x2200", "0x2100", "a9018d02"),
    }),
};

const memoryWith = (writes) => {
    const memory = new Uint8Array(0x10000);
    for (const [at, bytes] of writes) memory.set(bytes, at);
    return (address) => memory[address];
};

describe("matchingRegions", () => {
    it("lists every region whose anchors all match, by set and region", () => {
        const peek = memoryWith([
            [0x0400, [0xa9, 0x00, 0x8d, 0x01]],
            [0x2000, [0xde, 0xad, 0xbe, 0xef]],
        ]);
        expect(matchingRegions(sets, peek)).toEqual(["cheat/far", "loader/main"]);
    });
});

describe("overlappingRegions", () => {
    it("pairs matching regions over the same addresses, whichever sets they're in", () => {
        expect(overlappingRegions(sets, ["cheat/decrypted", "loader/main", "cheat/far"])).toEqual([
            "cheat/decrypted and loader/main",
        ]);
        expect(overlappingRegions(sets, ["cheat/far", "cheat/tail"])).toEqual(["cheat/far and cheat/tail"]);
        expect(overlappingRegions(sets, ["cheat/far", "loader/main"])).toEqual([]);
    });
});

describe("loadTitleSets", () => {
    it("reads a title's shipped sets by their ids", () => {
        const pipeline = loadTitleSets(path.join(SymbolsDir, "sets"), "pipeline");
        expect(Object.keys(pipeline)).toContain("game");
        expect(Object.keys(pipeline)).not.toContain("bbc-b-mos-1.20");
        expect(pipeline.game.regions.map(({ name }) => name)).toContain("main_high");
    });
});

describe("fetchDisc", () => {
    const url = "https://example.com/demo.zip";
    const image = "Games/Demo.ssd";
    const disc = new Uint8Array(0x400).map((_, i) => i * 7);
    const { discKey } = fingerprint(image, disc);

    afterEach(() => vi.restoreAllMocks());

    const serving = (files) =>
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(createZipBlob(files)));

    it("takes the named image out of the zip when its key is the config's", async () => {
        serving([{ name: image, data: disc }]);
        expect(await fetchDisc({ url, image, key: discKey })).toEqual(disc);
    });

    it("refuses an image whose key isn't the config's, or a zip without it", async () => {
        serving([{ name: image, data: disc }]);
        await expect(fetchDisc({ url, image, key: "0".repeat(32) })).rejects.toThrow(`is image ${discKey}`);
        await expect(fetchDisc({ url, image: "Other.ssd", key: discKey })).rejects.toThrow("holds no Other.ssd");
    });
});

describe("fetchRom", () => {
    const url = "https://example.com/demo.rom";
    const rom = new Uint8Array(0x4000).map((_, i) => i * 3);

    afterEach(() => vi.restoreAllMocks());

    it("returns the ROM when its key is the config's", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(rom));
        expect(await fetchRom({ url, key: romKey(rom) })).toEqual(rom);
    });

    it("refuses a ROM whose key isn't the config's", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(rom));
        await expect(fetchRom({ url, key: "0".repeat(32) })).rejects.toThrow(`is ROM ${romKey(rom)}`);
    });

    it("refuses a failed fetch", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("gone", { status: 404 }));
        await expect(fetchRom({ url, key: romKey(rom) })).rejects.toThrow(`Fetching ${url} failed with 404`);
    });
});

describe("loadSets", () => {
    it("loads the sets with the ids given, by their files' names", () => {
        const loaded = loadSets(path.join(SymbolsDir, "sets"), ["bbc-basic-2"]);
        expect(Object.keys(loaded)).toEqual(["bbc-basic-2"]);
        expect(loaded["bbc-basic-2"].title).toBe("BBC BASIC II");
    });
});

describe("romOf", () => {
    afterEach(() => vi.restoreAllMocks());

    it("reads jsbeeb's ROM by its file, and fetches any other by URL and key", async () => {
        expect(await romOf("BASIC.ROM")).toEqual(new Uint8Array(readFileSync(path.join(RomsDir, "BASIC.ROM"))));
        const rom = new Uint8Array(0x2000).fill(0x60);
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(rom));
        expect(await romOf({ url: "https://example.com/demo.rom", key: romKey(rom) })).toEqual(rom);
    });
});

describe("startMachine", () => {
    const RomTable = 0x02a1;
    const SidewaysRamBank = 7;
    const ServiceRom = 0x82;
    // A service ROM whose service entry only returns: its header, title and copyright.
    const rom = Uint8Array.from([
        0x00,
        0x00,
        0x00,
        0x4c,
        0x0e,
        0x80,
        ServiceRom,
        0x0f,
        0x01,
        ...Buffer.from("TEST"),
        0x00,
        0x60,
        0x00,
        ...Buffer.from("(C)"),
        0x00,
    ]);
    const tubeSets = loadTitleSets(path.join(SymbolsDir, "sets"), "dfs-2.26");
    const tubeRegions = (session) => matchingRegions(tubeSets, (at) => session.readMemory(at, 1)[0]);

    it("puts a sideways ROM in sideways RAM, where the MOS finds it", async () => {
        const session = await startMachine(null, { autoboot: false }, rom);
        try {
            expect(session.readMemory(0x8000, rom.length, { bank: SidewaysRamBank })).toEqual([...rom]);
            expect(session.readMemory(RomTable + SidewaysRamBank, 1)).toEqual([ServiceRom]);
        } finally {
            session.destroy();
        }
    });

    it("gives a B with DFS 1.2 a second processor when asked, whose Tube host DFS installs", async () => {
        for (const [tube, expected] of [
            [false, []],
            [true, ["tube/page5"]],
        ]) {
            const session = await startMachine(null, { autoboot: false, tube });
            try {
                expect(session.modelName).toBe("B-DFS1.2");
                expect(tubeRegions(session)).toEqual(expected);
            } finally {
                session.destroy();
            }
        }
    });

    it("starts the model asked for", async () => {
        const session = await startMachine(null, { model: "B1770", autoboot: false });
        const header = (bank) => Buffer.from(session.readMemory(0x8000, 0x20, { bank })).toString("latin1");
        const dfs = readFileSync(path.join(RomsDir, "b1770/dfs1770.rom")).subarray(0, 0x20).toString("latin1");
        try {
            expect(Array.from({ length: 16 }, (_, bank) => header(bank))).toContain(dfs);
        } finally {
            session.destroy();
        }
    });
});

describe("typeUntil", () => {
    const Routine = 0x0900;
    const Rts = 0x60;
    let session;

    beforeAll(async () => {
        session = await startMachine(null, { autoboot: false });
        session.writeMemory(Routine, [Rts]);
    });
    afterAll(() => session.destroy());

    it("stops where the typed command first reaches the address", async () => {
        await typeUntil(session, "CALL &900", Routine);
        expect(session.registers().pc).toBe(Routine);
    });

    it("refuses a command that never reaches it", async () => {
        await session.runUntilPrompt(5);
        await expect(typeUntil(session, "REM", Routine)).rejects.toThrow("Typing REM never reached &0900");
    });
});
