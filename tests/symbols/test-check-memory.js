import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createZipBlob } from "jsbeeb/src/archive.js";
import { RomsDir } from "../../tools/jsbeeb.js";
import { fingerprint } from "../../tools/registry/fingerprint.js";
import { decodeTape, tapeKey } from "../../tools/registry/tape.js";
import { SymbolsDir } from "../../tools/symbols/build-index.js";
import {
    bootsTape,
    fetchDisc,
    fetchTape,
    holdUntil,
    loadSets,
    loadTitleSets,
    matchingRegions,
    overlappingRegions,
    otherTitlesSets,
    runScript,
    scenarioContext,
    scenarioMedia,
    sidewaysRom,
    startMachine,
    typeUntil,
} from "../../tools/symbols/check-memory.js";
import { parseSet } from "jsbeeb/src/symbol-sets.js";
import { basicTape, TapeLoadCycles } from "../registry/tape-images.js";

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

const titleConfig = (id) => JSON.parse(readFileSync(path.join(SymbolsDir, "configs", `${id}.json`), "utf8"));

describe("loadTitleSets", () => {
    it("reads a title's shipped sets by their ids", () => {
        const pipeline = loadTitleSets(path.join(SymbolsDir, "sets"), titleConfig("pipeline"));
        expect(Object.keys(pipeline)).toContain("game");
        expect(Object.keys(pipeline)).not.toContain("bbc-b-mos-1.20");
        expect(Object.keys(loadTitleSets(path.join(SymbolsDir, "sets"), titleConfig("xmos")))).toEqual(["rom"]);
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

const Poked = 0x0900;
const PokedValue = 0x42;
const pokeTape = basicTape("?&900=&42");

describe("fetchTape", () => {
    const url = "https://example.com/demo.zip";
    const image = "Games/Demo.uef";
    const key = tapeKey(decodeTape(pokeTape).files);

    afterEach(() => vi.restoreAllMocks());

    it("takes the named tape out of the zip when its tape key is the config's, and refuses it otherwise", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
            async () => new Response(createZipBlob([{ name: image, data: pokeTape }])),
        );
        expect(await fetchTape({ url, image, key })).toEqual(pokeTape);
        await expect(fetchTape({ url, image, key: "0".repeat(32) })).rejects.toThrow(`is tape ${key}`);
    });

    it("refuses a tape image jsbeeb can't load", async () => {
        await expect(fetchTape({ url, image: "Games/Demo.csw", key })).rejects.toThrow("only UEF tapes");
    });
});

describe("loadSets", () => {
    it("loads the sets with the ids given, by their files' names", () => {
        const loaded = loadSets(path.join(SymbolsDir, "sets"), ["bbc-basic-2"]);
        expect(Object.keys(loaded)).toEqual(["bbc-basic-2"]);
        expect(loaded["bbc-basic-2"].title).toBe("BBC BASIC II");
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
    const tubeSets = loadTitleSets(path.join(SymbolsDir, "sets"), titleConfig("dfs-2.26"));
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

    it("runs a tape's first program", { timeout: 60000 }, async () => {
        const session = await startMachine(null, {}, null, { name: "poke.uef", data: pokeTape });
        try {
            await session.runFor(TapeLoadCycles);
            expect(session.readMemory(Poked, 1)).toEqual([PokedValue]);
        } finally {
            session.destroy();
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

    it("runs on when typing ends before the line is read, as a ROM that takes over line input leaves it", async () => {
        let pc = 0;
        const late = {
            addBreakpoint: () => 1,
            removeBreakpoint: vi.fn(),
            type: async () => {},
            registers: () => ({ pc }),
            runFor: vi.fn(async () => {
                pc = Routine;
            }),
        };
        await typeUntil(late, "*ALIAS", Routine);
        expect(late.runFor).toHaveBeenCalledOnce();
        expect(late.removeBreakpoint).toHaveBeenCalledWith(1);
    });

    it("refuses a command that never reaches it", async () => {
        await session.runUntilPrompt(5);
        await expect(typeUntil(session, "REM", Routine)).rejects.toThrow("Typing REM never reached &0900");
    });
});

describe("scenarioContext's check", () => {
    afterEach(() => vi.restoreAllMocks());

    it("looks at the sideways bank a moment names, or else at what's paged in", () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const LoaderBank = 3;
        const banked = new Uint8Array(0x10000);
        banked.set([0xa9, 0x00, 0x8d, 0x01], 0x0400);
        const session = {
            readMemory: (at, _length, { bank }) => [bank === LoaderBank ? banked[at] : 0],
            registers: () => ({ pc: 0 }),
        };
        const results = [];
        const { check } = scenarioContext(session, { loader: sets.loader }, null, undefined, results);
        check("in the bank", ["loader/main"], { bank: LoaderBank });
        check("paged in", []);
        check("paged in, wrongly expected", ["loader/main"]);
        expect(results).toEqual([true, true, false]);
    });

    it("looks at shadow or main RAM when a moment says which", () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const session = {
            readMemory: (at, _length, { shadow }) => [
                shadow ? memoryWith([[0x0400, [0xa9, 0x00, 0x8d, 0x01]]])(at) : 0,
            ],
            registers: () => ({ pc: 0 }),
        };
        const results = [];
        const { check } = scenarioContext(session, { loader: sets.loader }, null, undefined, results);
        check("in shadow RAM", ["loader/main"], { shadow: true });
        check("in main RAM", [], { shadow: false });
        expect(results).toEqual([true, true]);
    });
});

describe("runScript", () => {
    const recording = ({ reaches = true } = {}) => {
        const calls = [];
        return {
            calls,
            keyDown: (code) => calls.push(`down ${code}`),
            keyUp: (code) => calls.push(`up ${code}`),
            keyDownRaw: (key) => calls.push(`down ${key}`),
            keyUpRaw: (key) => calls.push(`up ${key}`),
            runUntilAddress: async (address) => {
                calls.push(`until ${address}`);
                if (!reaches) throw new Error("did not hit appropriate breakpoint");
            },
        };
    };

    it("holds a key until the PC reaches an address, or runs until it does", async () => {
        const session = recording();
        await runScript(session, ["hold Space &1F00", "until &2000"]);
        expect(session.calls).toEqual(["down Space", "until 7936", "up Space", "until 8192"]);
    });

    it("refuses an address that isn't &hex", async () => {
        await expect(runScript(recording(), ["until 1F00"])).rejects.toThrow("not 1F00");
    });

    it("lets go of a held key when the PC never gets there, as holdUntil does", async () => {
        const session = recording({ reaches: false });
        await expect(runScript(session, ["hold Space &1F00"])).rejects.toThrow("breakpoint");
        await expect(holdUntil(session, "SPACE", 0x1f00)).rejects.toThrow("breakpoint");
        expect(session.calls.filter((call) => call.startsWith("up"))).toEqual(["up Space", "up SPACE"]);
    });
});

describe("bootsTape", () => {
    it("boots the tape when there's no disc or it's asked for, and refuses to when there's none", () => {
        expect(bootsTape(true, true)).toBe(false);
        expect(bootsTape(false, true)).toBe(true);
        expect(bootsTape(true, true, true)).toBe(true);
        expect(bootsTape(true, false)).toBe(false);
        expect(() => bootsTape(true, false, true)).toThrow("the config names none");
    });
});

describe("sidewaysRom", () => {
    it("takes the file an assembled ROM's build saves, and refuses one it doesn't", async () => {
        const saved = new Map([["build.rom", Uint8Array.from([1, 2, 3])]]);
        expect(await sidewaysRom({ rom: { file: "build.rom" } }, saved)).toEqual(Uint8Array.from([1, 2, 3]));
        await expect(sidewaysRom({ rom: { file: "other.rom" } }, saved)).rejects.toThrow(
            "The build saves no other.rom",
        );
    });

    it("has none for a config with no ROM, or one jsbeeb has", async () => {
        expect(await sidewaysRom({}, null)).toBeNull();
        expect(await sidewaysRom({ rom: "BASIC.ROM" }, null)).toBeNull();
    });
});

describe("scenarioMedia", () => {
    it("boots the title's disc and ROM unless the machine names another of the checkout's", () => {
        const rom = Uint8Array.from([9]);
        expect(scenarioMedia({}, "/src", "/src/game.ssd", rom)).toEqual({ disc: "/src/game.ssd", rom, tape: null });
        const fromCheckout = scenarioMedia({ disc: "orig.ssd", rom: "README.md" }, SymbolsDir, null, rom);
        expect(fromCheckout.disc).toBe(path.join(SymbolsDir, "orig.ssd"));
        expect(Buffer.from(fromCheckout.rom).toString("latin1")).toContain("Symbol sets");
    });

    it("boots the tape when there's no disc, or the machine asks for it", () => {
        const tape = { name: "game.uef", data: pokeTape };
        expect(scenarioMedia({}, undefined, null, null, tape)).toEqual({ disc: null, rom: null, tape });
        expect(scenarioMedia({}, undefined, "game.ssd", null, tape).tape).toBeNull();
        expect(scenarioMedia({ tape: true }, undefined, "game.ssd", null, tape)).toEqual({
            disc: null,
            rom: null,
            tape,
        });
        expect(() => scenarioMedia({ tape: true }, undefined, "game.ssd", null)).toThrow("the config names none");
    });

    it("refuses another disc or ROM for a title it didn't build", () => {
        expect(() => scenarioMedia({ disc: "orig.ssd" }, undefined, null, null)).toThrow("Only an assembled title");
        expect(() => scenarioMedia({ rom: "orig.rom" }, undefined, null, null)).toThrow("Only an assembled title");
    });
});

describe("otherTitlesSets", () => {
    it("keys another title's sets by its config id and set id", () => {
        const others = otherTitlesSets(path.join(SymbolsDir, "sets"), path.join(SymbolsDir, "configs"), ["xmos-1992"]);
        expect(Object.keys(others)).toEqual(["xmos-1992-rom"]);
    });
});
