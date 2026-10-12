import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSet } from "jsbeeb/src/symbol-sets.js";
import { regionMatches } from "jsbeeb/src/symbol-names.js";
import { checkSet, readMosSets, SymbolsDir } from "../../tools/symbols/build-index.js";
import {
    importAcornaeology,
    pageAnchors,
    readDisassembly,
    romMatches,
    versionsOf,
} from "../../tools/symbols/import-acornaeology.js";

const ConfigsDir = new URL("../../symbols/configs/", import.meta.url);
const Base = 0x8000;
const RomSize = 0x100;
const Pairs = 51;
const OpcodeLdaImmediate = 0xa9;
const OpcodeStaAbsolute = 0x8d;
const OpcodeRts = 0x60;
const PairBytes = 5;
const StaOffset = 2;
const SecondHalf = 0x8082;
const LateInLow = 0x8070;
const MovedTo = 0x0400;
const MovedFrom = Base + Pairs * PairBytes;
const OpcodeNop = 0xea;

const config = {
    importer: "acornaeology",
    licence: "MIT",
    source: {
        repository: "https://github.com/example/demo",
        commit: "0123456789abcdef0123456789abcdef01234567",
        licenceFile: "LICENSE",
    },
    globals: [{ start: "0x0000", end: "0x0800" }],
    bytesPerAnchor: 0x80,
    spreadAnchors: 1,
    sets: [
        {
            id: "demo-1",
            title: "Demo ROM",
            disassembly: "versions/1/output/demo.json",
            rom: "DEMO.ROM",
            regions: [
                { name: "low", start: "0x8000", end: "0x8080" },
                { name: "high", start: "0x8080", end: "0x8100" },
            ],
        },
    ],
};
const [version] = versionsOf(config);

/** LDA #n then STA &3000+n, for each n, and an RTS to fill the ROM. */
function items() {
    const out = [];
    for (let n = 0; n < Pairs; n++) {
        const addr = Base + n * PairBytes;
        out.push({ addr, bytes: [OpcodeLdaImmediate, n], type: "code", mnemonic: "lda" });
        out.push({ addr: addr + StaOffset, bytes: [OpcodeStaAbsolute, n, 0x30], type: "code", mnemonic: "sta" });
    }
    out.push({ addr: Base + Pairs * PairBytes, bytes: [OpcodeRts], type: "code", mnemonic: "rts" });
    out.find(({ addr }) => addr === Base).labels = ["entry"];
    out.find(({ addr }) => addr === SecondHalf).labels = ["second_half"];
    return out;
}

const disassemblyJson = (overrides = {}) => ({
    meta: { schema_version: 4, load_addr: Base, end_addr: Base + RomSize, title: "Demo" },
    constants: [{ name: "osbyte_read_himem", value: 0x84 }],
    subroutines: [{ addr: Base, name: "entry" }],
    items: items(),
    external_labels: {
        zp_ptr: 0x00,
        zp_ptr_1: 0x01,
        os_text_ptr: 0xf2,
        temps: 0x46c,
        temp1: 0x46c,
        osbyte: 0xfff4,
    },
    memory_map: [
        { addr: 0x00, name: "zp_ptr", length: 2 },
        { addr: 0x46c, name: "temp1", length: 5 },
    ],
    ...overrides,
});

/** The demo, with its last pair's STA also labelled, a label inside an LDA, and the RTS moved to &0400. */
function withExtras() {
    const json = disassemblyJson();
    const rts = json.items.at(-1);
    json.items[json.items.length - 1] = { ...rts, addr: MovedTo, binary_addr: MovedFrom, labels: ["moved_rts"] };
    json.items.find(({ addr }) => addr === SecondHalf).labels.push("second_half_too");
    json.items.find(({ addr }) => addr === Base + PairBytes).sub_labels = { [Base + PairBytes + 1]: ["operand"] };
    return json;
}

const romOf = (json) => {
    const rom = new Uint8Array(RomSize);
    for (const { addr, binary_addr: binaryAddr = addr, bytes } of json.items) rom.set(bytes, binaryAddr - Base);
    return rom;
};

const systemGlobals = new Map([[0xf2, "os_text_ptr"]]);

function imported({ json = disassemblyJson(), rom = romOf(json), otherRoms = [] } = {}) {
    return importAcornaeology(version, readDisassembly(json), { rom, otherRoms, systemGlobals, notice: "Notice" });
}

describe("readDisassembly", () => {
    it("reads the statements, the labels and the names outside the ROM", () => {
        const read = readDisassembly(disassemblyJson());
        expect(read.base).toBe(Base);
        expect(read.end).toBe(Base + RomSize);
        expect(read.statements[1]).toEqual({
            address: Base + StaOffset,
            data: [OpcodeStaAbsolute, 0, 0x30],
            code: true,
        });
        expect(read.labels).toEqual([
            { address: Base, name: "entry", item: Base },
            { address: SecondHalf, name: "second_half", item: SecondHalf },
        ]);
        expect(read.outside).toContainEqual({ address: 0x46c, name: "temp1", mapped: true });
        expect(read.outside).toContainEqual({ address: 0x46c, name: "temps", mapped: false });
    });

    it("refuses a schema it doesn't know", () => {
        const json = disassemblyJson();
        json.meta.schema_version = 3;
        expect(() => readDisassembly(json)).toThrow("schema version 3, not 4");
    });
});

describe("readDisassembly of code the ROM moves", () => {
    it("puts its bytes where they are in the ROM, and its labels apart", () => {
        const read = readDisassembly(withExtras());
        expect(read.statements.at(-1)).toEqual({ address: MovedFrom, data: [OpcodeRts], code: true });
        expect(read.moved).toEqual([{ address: MovedTo, name: "moved_rts" }]);
        expect(read.labels).toContainEqual({ address: Base + PairBytes + 1, name: "operand", item: Base + PairBytes });
    });
});

describe("versionsOf", () => {
    it("fills in the config's shared fields, which a version can override", () => {
        const ownGlobals = [{ start: "0xc000", end: "0xc300" }];
        const [first, second] = versionsOf({
            ...config,
            sets: [config.sets[0], { ...config.sets[0], id: "demo-2", globals: ownGlobals }],
        });
        expect(first).toMatchObject({ id: "demo-1", licence: "MIT", globals: config.globals, bytesPerAnchor: 0x80 });
        expect(second).toMatchObject({ id: "demo-2", globals: ownGlobals });
    });
});

describe("pageAnchors", () => {
    it("takes each address's anchor id as the page writes it", () => {
        const html = '<tr id="addr-800E"><td>.go</td></tr><a href="#addr-8010">x</a><p id="addr-00f2"></p>';
        expect(pageAnchors(html)).toEqual(
            new Map([
                [0x800e, "addr-800E"],
                [0x00f2, "addr-00f2"],
            ]),
        );
    });
});

describe("importAcornaeology", () => {
    it("names each region's addresses from the labels in it", () => {
        const { json, errors } = imported();
        expect(errors).toEqual([]);
        expect(json.regions.low.symbols).toEqual({ entry: "0x8000" });
        expect(json.regions.high.symbols).toEqual({ second_half: "0x8082" });
    });

    it("takes globals only from its ranges, leaving the system sets' addresses to them", () => {
        const { json, dropped } = imported();
        expect(json.globals).toEqual({ zp_ptr: "0x0000", zp_ptr_1: "0x0001", temp1: "0x046c" });
        expect(dropped).toContainEqual(["os_text_ptr", 0xf2, "the system sets call it os_text_ptr"]);
        expect(dropped).toContainEqual(["osbyte", 0xfff4, "it's outside the globals' ranges"]);
    });

    it("prefers the memory map's name for an address with two", () => {
        const { dropped } = imported();
        expect(dropped).toContainEqual(["temps", 0x46c, "the memory map calls it temp1"]);
    });

    it("fails on two names for an address that the memory map doesn't choose between", () => {
        const { errors } = imported({ json: disassemblyJson({ memory_map: [] }) });
        expect(errors).toEqual(["&046C has names temps, temp1 and none to prefer"]);
    });

    it("anchors each region on the ROM's bytes, with as many required as it has", () => {
        const { json } = imported();
        const rom = romOf(disassemblyJson());
        for (const region of parseSet(json).regions) {
            expect(region.anchors.length).toBeGreaterThan(0);
            expect(region.minAnchors).toBe(region.anchors.length);
            expect(regionMatches(region, (address) => rom[address - Base])).toBe(true);
        }
    });

    it("adds an anchor where another ROM differs, in whichever of its banks", () => {
        const anchorsBefore = parseSet(imported().json).regions[0].anchors.length;
        const other = romOf(disassemblyJson());
        other[LateInLow - Base] ^= 0xff;
        const twoBanks = new Uint8Array(RomSize * 2);
        twoBanks.set(other, RomSize);
        const { json, errors } = imported({ otherRoms: [{ name: "BANKS", bytes: twoBanks }] });
        expect(errors).toEqual([]);
        const low = parseSet(json).regions[0];
        expect(low.anchors.length).toBe(anchorsBefore + 1);
        expect(regionMatches(low, (address) => other[address - Base])).toBe(false);
    });

    it("refuses a ROM whose bytes aren't the disassembly's", () => {
        const rom = romOf(disassemblyJson());
        rom[5] ^= 0xff;
        const { json, errors } = imported({ rom });
        expect(json).toBeNull();
        expect(errors).toEqual(["The disassembly's bytes at &8005 aren't DEMO.ROM's"]);
    });

    it("refuses a ROM that isn't the disassembly's size", () => {
        const rom = romOf(disassemblyJson()).subarray(0, RomSize / 2);
        const { json, errors } = imported({ rom });
        expect(json).toBeNull();
        expect(errors).toEqual(["DEMO.ROM is 128 bytes, the disassembly 256"]);
    });

    const linked = (anchorsHtml) => {
        const json = disassemblyJson();
        return importAcornaeology({ ...version, home: "https://example.com/demo/1.html" }, readDisassembly(json), {
            rom: romOf(json),
            otherRoms: [],
            systemGlobals,
            notice: "Notice",
            anchors: pageAnchors(anchorsHtml),
        });
    };

    it("links each name whose address has an anchor on the config's home page, and no other", () => {
        const { json, errors } = linked('<tr id="addr-8000"></tr><tr id="addr-8082"></tr><tr id="addr-0000"></tr>');
        expect(errors).toEqual([]);
        expect(checkSet(json, { file: "sets/demo.json", mosSets: [] })).toEqual([]);
        expect(json.home).toBe("https://example.com/demo/1.html");
        expect(json.nameLink).toBe("https://example.com/demo/{place}");
        expect(json.places).toEqual({
            entry: "1.html#addr-8000",
            second_half: "1.html#addr-8082",
            zp_ptr: "1.html#addr-0000",
        });
    });

    it("fails on a name in the ROM the page has no anchor for", () => {
        expect(linked('<tr id="addr-8000"></tr>').errors).toEqual([
            "https://example.com/demo/1.html has no anchor for second_half",
        ]);
    });

    it("links no names without anchors", () => {
        const { json } = imported();
        expect(json.nameLink).toBeUndefined();
        expect(json.places).toBeUndefined();
    });

    it("names each address after its first label, and leaves out the labels of code the ROM moves", () => {
        const json = withExtras();
        const { json: set, errors, dropped } = imported({ json });
        expect(errors).toEqual([]);
        expect(set.regions.high.symbols).toEqual({ second_half: "0x8082" });
        expect(set.regions.low.symbols.operand).toBe("0x8006");
        expect(dropped).toContainEqual(["second_half_too", SecondHalf, "it's also second_half"]);
        expect(dropped).toContainEqual(["moved_rts", MovedTo, "it's in code the ROM moves"]);
    });

    it("links a label inside an item to the item's anchor", () => {
        const json = withExtras();
        const { json: set, errors } = importAcornaeology(
            { ...version, home: "https://example.com/demo/1.html" },
            readDisassembly(json),
            {
                rom: romOf(json),
                otherRoms: [],
                systemGlobals,
                notice: "Notice",
                anchors: pageAnchors('<tr id="addr-8000"></tr><tr id="addr-8005"></tr><tr id="addr-8082"></tr>'),
            },
        );
        expect(errors).toEqual([]);
        expect(set.places.operand).toBe("1.html#addr-8005");
    });

    describe("a region with the same code in another ROM", () => {
        const sharing = (sameCodeIn) => ({
            ...version,
            regions: [{ ...version.regions[0], sameCodeIn }, version.regions[1]],
        });
        const patched = () => {
            const other = romOf(disassemblyJson());
            other[Base + StaOffset + 1 - Base] = OpcodeNop;
            return other;
        };

        it("keeps its anchors off the bytes that ROM changes, so that it matches there too", () => {
            const json = disassemblyJson();
            const other = patched();
            const { json: set, errors } = importAcornaeology(sharing(["OTHER"]), readDisassembly(json), {
                rom: romOf(json),
                otherRoms: [{ name: "OTHER", bytes: other }],
                systemGlobals,
                notice: "Notice",
            });
            expect(errors).toEqual([]);
            const [low, high] = parseSet(set).regions;
            expect(regionMatches(low, (address) => other[address - Base])).toBe(true);
            expect(regionMatches(high, (address) => other[address - Base])).toBe(true);
        });

        it("refuses a ROM that isn't there, or isn't the same code", () => {
            const json = disassemblyJson();
            const run = (otherRoms) =>
                importAcornaeology(sharing(["OTHER"]), readDisassembly(json), {
                    rom: romOf(json),
                    otherRoms,
                    systemGlobals,
                    notice: "Notice",
                }).errors;
            expect(run([])).toContain("demo-1/low: there's no OTHER to share its code with");
            expect(run([{ name: "OTHER", bytes: new Uint8Array(RomSize).fill(OpcodeNop) }])).toContain(
                "demo-1/low: OTHER differs in 128 bytes, so isn't the same code",
            );
        });
    });

    it("tells apart the start of a shorter ROM", () => {
        const shorter = romOf(disassemblyJson()).slice(0, RomSize / 2);
        shorter[LateInLow - Base] ^= 0xff;
        const { json, errors } = imported({ otherRoms: [{ name: "SHORT", bytes: shorter }] });
        expect(errors).toEqual([]);
        expect(regionMatches(parseSet(json).regions[0], (address) => shorter[address - Base])).toBe(false);
    });

    it("writes a set that passes the index's checks", () => {
        const { json } = imported();
        expect(json.source).toBe(`${config.source.repository}/blob/${config.source.commit}/${version.disassembly}`);
        expect(checkSet(json, { file: "sets/demo.json", mosSets: [] })).toEqual([]);
    });
});

describe("romMatches", () => {
    it("lists what each ROM matches, and the pairs that overlap", () => {
        const { json } = imported();
        const rom = romOf(disassemblyJson());
        const sets = { a: parseSet(json), b: parseSet(json) };
        const [match] = romMatches(sets, [{ name: "DEMO.ROM", bytes: rom }], Base);
        expect(match.found).toEqual(["a/high", "a/low", "b/high", "b/low"]);
        expect(match.overlaps).toEqual(["a/high and b/high", "a/low and b/low"]);
    });
});

describe("the acornaeology configs", () => {
    const configs = readdirSync(ConfigsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(new URL(name, ConfigsDir), "utf8")))
        .filter(({ importer }) => importer === "acornaeology");

    it("each have their versions' sets shipped, made from the commit they name", () => {
        expect(configs.length).toBeGreaterThan(0);
        for (const set of configs.flatMap(versionsOf)) {
            const file = `sets/${set.id}.json`;
            const json = JSON.parse(readFileSync(path.join(SymbolsDir, file), "utf8"));
            expect(json.source, set.id).toBe(`${set.source.repository}/blob/${set.source.commit}/${set.disassembly}`);
            expect(checkSet(json, { file, mosSets: readMosSets() })).toEqual([]);
        }
    });
});
