import { describe, expect, it } from "vitest";

import { parseSet } from "jsbeeb/src/symbol-sets.js";
import { regionMatches } from "jsbeeb/src/symbol-names.js";
import { checkSet } from "../../tools/symbols/build-index.js";
import { importAcme, importAcmeSet, pageDefinitions } from "../../tools/symbols/import-acme.js";

const Base = 0x8000;
const RomSize = 0x100;
const Pairs = 51;
const PairBytes = 5;
const OpcodeLdaImmediate = 0xa9;
const OpcodeStaZeroPage = 0x85;
const OpcodeStaAbsolute = 0x8d;
const OpcodeRts = 0x60;
const Workspace = 0x70;
const Io = 0xfe40;
const Middle = 0x8080;
const Source = "src/demo.a";
const Repository = "https://github.com/example/demo";
const Commit = "0123456789abcdef0123456789abcdef01234567";

/** LDA #n then a store, for each n: to the workspace for the first two, to the I/O port after. */
function demoBuild() {
    const binary = new Uint8Array(RomSize).fill(OpcodeRts);
    const statements = [];
    for (let n = 0; n < Pairs; n++) {
        const at = Base + n * PairBytes;
        const zeroPage = n < 2;
        const store = zeroPage ? [OpcodeStaZeroPage, Workspace] : [OpcodeStaAbsolute, Io & 0xff, Io >> 8];
        binary.set([OpcodeLdaImmediate, n, ...store], at - Base);
        statements.push(
            { address: at, data: [OpcodeLdaImmediate, n], text: "    lda #.count", line: 10 + n * 2 },
            {
                address: at + 2,
                data: store,
                text: zeroPage ? `    sta .${n === 0 ? "work" : "temp"}` : "    sta .port",
                line: 11 + n * 2,
            },
        );
    }
    const definitions = [
        { name: ".count", line: 1, label: false, value: 3 },
        { name: ".work", line: 2, label: false, value: Workspace },
        { name: ".temp", line: 3, label: false, value: Workspace },
        { name: ".port", line: 4, label: false, value: Io },
        { name: ".unused", line: 5, label: false, value: 0x71 },
        { name: ".entry", line: 8, label: true, value: Base },
        { name: ".start", line: 9, label: true, value: Base },
        { name: ".XXX_gap", line: 20, label: true, value: Base + 0x10 },
        { name: ".high", line: 60, label: true, value: Middle + 2 },
        { name: "beyond", line: 200, label: true, value: Base + 0xf0 },
    ];
    return { base: Base, binary, statements, definitions };
}

const config = {
    id: "demo",
    importer: "acme",
    licence: "CC-BY-NC-4.0",
    notice: "The names are the demo's.",
    source: { repository: Repository, commit: Commit },
    globals: [
        { start: "0x0000", end: "0x0800" },
        { start: "0xfc00", end: "0xff00" },
    ],
    leaveOut: ["XXX"],
    bytesPerAnchor: 0x80,
    spreadAnchors: 1,
    sets: [
        {
            id: "1",
            title: "Demo ROM",
            assemble: Source,
            rom: "DEMO.ROM",
            regions: [
                { name: "low", from: "&8000", to: "&8080" },
                { name: "high", from: "&8080", to: "high + &6E" },
            ],
        },
    ],
};
const [spec] = config.sets;

const importDemo = (options = {}, build = demoBuild(), setConfig = config) =>
    importAcmeSet(setConfig, spec, build, {
        rom: build.binary,
        otherRoms: [],
        systemGlobals: new Map(),
        ...options,
    });

describe("importAcmeSet", () => {
    it("names the labels in each region, the last written at an address winning", () => {
        const { json, dropped } = importDemo();
        expect(json.regions.low.symbols).toEqual({ start: "0x8000" });
        expect(json.regions.high.symbols).toEqual({ high: "0x8082" });
        expect(dropped).toContainEqual(["entry", Base, "low calls it start"]);
        expect(dropped).toContainEqual(["beyond", Base + 0xf0, "no region holds it"]);
        expect(dropped).toContainEqual(["XXX_gap", Base + 0x10, "the config leaves it out"]);
    });

    it("takes as globals the = names stores use, in the globals' ranges, the most used at an address", () => {
        const { json, dropped } = importDemo();
        expect(json.globals).toEqual({ work: "0x0070", port: "0xfe40" });
        expect(dropped).toContainEqual(["temp", Workspace, "the globals call it work"]);
        expect(dropped).toContainEqual(["unused", 0x71, "no instruction uses it as a memory operand"]);
        expect(dropped).toContainEqual(["count", 3, "no instruction uses it as a memory operand"]);
    });

    it("leaves the system sets' addresses to them, unless it's a system set itself", () => {
        const system = new Map([[Io, "via_b"]]);
        expect(importDemo({ systemGlobals: system }).json.globals).toEqual({ work: "0x0070" });
        const { json } = importDemo({ systemGlobals: system }, demoBuild(), { ...config, system: true });
        expect(json.globals).toEqual({ work: "0x0070", port: "0xfe40" });
        expect(json.system).toBe(true);
    });

    it("links each name to the line of the source that defines it at the config's commit", () => {
        const { json } = importDemo();
        expect(json.source).toBe(`${Repository}/blob/${Commit}/${Source}`);
        expect(json.nameLink).toBe(`${Repository}/blob/${Commit}/{place}`);
        expect(json.places).toEqual({
            high: `${Source}#L60`,
            port: `${Source}#L4`,
            start: `${Source}#L9`,
            work: `${Source}#L2`,
        });
    });

    it("links to the set's pages instead, where it has them, and refuses a name they don't define", () => {
        const url = "https://example.com/demo/";
        const pages = new Map([
            ["start", ["s1.html#SP1"]],
            ["high", ["s2.html#SP4"]],
            ["work", ["s0.html#SP2"]],
        ]);
        const withPages = { ...spec, pages: { directory: "docs", url } };
        const { json, errors } = importAcmeSet(config, withPages, demoBuild(), {
            rom: demoBuild().binary,
            otherRoms: [],
            systemGlobals: new Map(),
            pages,
        });
        expect(json.nameLink).toBe(`${url}{place}`);
        expect(json.places.high).toBe("s2.html#SP4");
        expect(errors).toEqual(["1: no one place to link for port"]);
    });

    it("refuses a ROM whose bytes in a region aren't what the source assembles to", () => {
        const rom = demoBuild().binary.slice();
        rom[0x90] ^= 0xff;
        const { errors } = importDemo({ rom });
        expect(errors).toEqual([`1/high: ${Source} assembles to bytes that aren't DEMO.ROM's at &8090`]);
    });

    it("makes a set the index accepts, matching its own ROM", () => {
        const build = demoBuild();
        const { json, errors } = importDemo({}, build);
        expect(errors).toEqual([]);
        expect(checkSet(json, { file: "sets/demo-1.json", mosSets: [] })).toEqual([]);
        const set = parseSet(json);
        for (const region of set.regions)
            expect(regionMatches(region, (address) => build.binary[address - Base])).toBe(true);
    });
});

describe("importAcme", () => {
    it("tells each version apart from the other versions' ROMs", () => {
        const first = demoBuild();
        const second = demoBuild();
        for (const address of [Base + 0x60, Middle + 0x20]) {
            second.binary[address - Base] ^= 0xff;
            const statement = second.statements.find(
                ({ address: at, data }) => at <= address && address < at + data.length,
            );
            statement.data = Array.from(
                second.binary.subarray(statement.address - Base, statement.address - Base + statement.data.length),
            );
        }
        const twoVersions = {
            ...config,
            sets: [spec, { ...spec, id: "2", assemble: "src/two.a", rom: "TWO.ROM" }],
        };
        const builds = new Map([
            [Source, first],
            ["src/two.a", second],
        ]);
        const { sets, errors } = importAcme(twoVersions, builds, [first.binary, second.binary], []);
        expect(errors).toEqual([]);
        const [one, two] = sets.map(({ json }) => parseSet(json));
        const peek = (binary) => (address) => binary[address - Base];
        expect(one.regions.map((region) => regionMatches(region, peek(second.binary)))).toEqual([false, false]);
        expect(two.regions.map((region) => regionMatches(region, peek(first.binary)))).toEqual([false, false]);
    });
});

describe("pageDefinitions", () => {
    it("places each name defined at a line's start in the paragraph before it", () => {
        const html = [
            '<a id="SP1" class="paragraph-anchor"></a>',
            "<pre>",
            '<span class="ACME-plain-syntax">.</span><span class="ACME-function-syntax">first</span>',
            '<span class="ACME-plain-syntax">    lda </span><span class="ACME-plain-syntax">.</span><span class="ACME-function-syntax">used</span>',
            '<a id="SP2" class="paragraph-anchor"></a>',
            '<span class="ACME-plain-syntax">.</span><span class="ACME-constant-syntax">second</span> = $70',
        ].join("\n");
        expect([...pageDefinitions([{ file: "S-s1.html", html }])]).toEqual([
            ["first", ["S-s1.html#SP1"]],
            ["second", ["S-s1.html#SP2"]],
        ]);
    });
});
