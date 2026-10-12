import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { fake6502 } from "jsbeeb/src/fake6502.js";
import { loadData, setNodeBasePath } from "jsbeeb/src/loader.js";
import { findModel } from "jsbeeb/src/models.js";
import { SymbolSets } from "jsbeeb/src/symbol-sets.js";

import { JsbeebDir, RomsDir } from "../../tools/jsbeeb.js";
import { SymbolsDir } from "../../tools/symbols/build-index.js";

const RealSymbols = pathToFileURL(SymbolsDir).href;
const OsBase = 0xc000;
const OsSize = 0x4000;
const SidewaysBase = 0x8000;
const SidewaysSize = 0x4000;

describe("the shipped ROM sets", () => {
    beforeAll(() => setNodeBasePath(JsbeebDir));

    const loadReal = vi.fn(async (url) => JSON.parse(new TextDecoder().decode(await loadData(url))));

    const namesFor = async (peek) => {
        loadReal.mockClear();
        const sets = new SymbolSets({ baseUrl: RealSymbols, load: loadReal });
        for (let stop = 0; stop < 3; stop++) {
            sets.names(peek);
            await vi.waitFor(() => expect(loadReal.mock.settledResults.at(-1)?.type).not.toBe("incomplete"));
        }
        return sets.names(peek);
    };

    const withRoms = (sideways) => {
        const memory = new Uint8Array(0x10000);
        memory.set(readFileSync(path.join(RomsDir, "os.rom")).subarray(0, OsSize), OsBase);
        memory.set(readFileSync(path.join(RomsDir, sideways)).subarray(0, SidewaysSize), SidewaysBase);
        return (address) => memory[address];
    };

    it("names BASIC II's code and workspace while it's paged in, beside the MOS", async () => {
        const names = await namesFor(withRoms("BASIC.ROM"));
        const nameOf = (at, target) => names.operand(at, target)?.name;
        expect(names.sets.map(({ title }) => title).sort()).toEqual(["BBC BASIC II", "BBC Micro MOS 1.20"]);
        expect(nameOf(0x8b9d, 0x0b)).toBe("zp_text_ptr");
        expect(nameOf(0x2000, 0x8b9b)).toBe("statement_loop");
        expect(nameOf(0x8b9d, 0xffee)).toBe("oswrch");
        expect(nameOf(0x8b9d, 0xf2)).toBe("os_text_ptr");
        expect(nameOf(0xe0a4, 0x0b)).toBeUndefined();
        expect(nameOf(0x2000, 0x0b)).toBeUndefined();
        expect(names.address(0x0000)?.name).toBe("zp_lomem");
        expect(names.address(0x8023)?.name).toBe("language_startup");
    });

    it.each(["a01/BASIC1.rom", "us/USBASIC.rom", "compact/basic48.rom", "b/DFS-1.2.rom"])(
        "leaves BASIC II's names out while %s is paged in",
        async (rom) => {
            const names = await namesFor(withRoms(rom));
            expect(names.sets.map(({ title }) => title)).not.toContain("BBC BASIC II");
        },
    );

    it.each([
        ["b/DFS-1.2.rom", "Acorn NFS 3.60", 0x9015, "copy_fs_addr"],
        ["us/USDNFS.rom", "Acorn NFS 3.40", 0x900b, "copy_fs_addr"],
        ["master/anfs-4.25.rom", "Acorn ANFS 4.25", 0xb003, "send_disconnect_status"],
    ])("names %s's network filing system as %s", async (rom, title, address, name) => {
        const names = await namesFor(withRoms(rom));
        expect(names.sets.map((set) => set.title).sort()).toEqual([title, "BBC Micro MOS 1.20"]);
        expect(names.address(address)?.name).toBe(name);
    });

    it.each([0x00a0, 0x00b0, 0x0d00, 0x0dba, 0x0e00, 0x1000, 0x0000, 0x0400])(
        "gives no NFS name to &%s, which DNFS 1.20's DFS or another owner uses",
        async (address) => {
            const names = await namesFor(withRoms("b/DFS-1.2.rom"));
            expect(names.sets.map(({ title }) => title)).toContain("Acorn NFS 3.60");
            expect(names.address(address)?.name).toBeUndefined();
        },
    );

    it("names DNFS 1.20's Econet workspace from NFS 3.60", async () => {
        const names = await namesFor(withRoms("b/DFS-1.2.rom"));
        expect(names.address(0x009a)?.name).toBe("net_tx_ptr");
        expect(names.address(0x0d61)?.name).toBe("printer_buf_ptr");
    });

    it("leaves DNFS 1.20's DFS to no network set", async () => {
        const names = await namesFor(withRoms("b/DFS-1.2.rom"));
        expect(names.address(0x9f9d)).toBeUndefined();
        expect(names.address(0xa000)).toBeUndefined();
    });

    it.each(["b1770/dfs1770.rom", "bp/dfs.rom"])("names DFS 2.26's code while %s is paged in", async (rom) => {
        const names = await namesFor(withRoms(rom));
        expect(names.sets.map(({ title }) => title).sort()).toEqual(["Acorn DFS 2.26", "BBC Micro MOS 1.20"]);
        expect(names.operand(0x2000, 0x8048)?.name).toBe("generate_error");
        expect(names.address(0xb1b1)?.name).toBe("general_service_handler");
    });

    it.each(["BASIC.ROM", "b/DFS-1.2.rom", "b/DFS-0.9.rom"])(
        "leaves DFS 2.26's names out while %s is paged in",
        async (rom) => {
            const names = await namesFor(withRoms(rom));
            expect(names.sets.map(({ title }) => title)).not.toContain("Acorn DFS 2.26");
        },
    );

    it("names a B's MOS and hardware, reading memory as the CPU sees it", async () => {
        const cpu = fake6502(findModel("B"));
        await cpu.initialise();
        const names = await namesFor((address) => cpu.peekmem(address));
        const nameOf = (at, target) => names.operand(at, target)?.name;
        expect(names.sets.map(({ title }) => title)).toEqual(["BBC Micro MOS 1.20"]);
        expect(nameOf(0x2000, 0xffee)).toBe("oswrch");
        expect(nameOf(0x2000, 0xfe40)).toBe("system_via_register_b");
        expect(nameOf(0xe0a4, 0x20e)).toBe("wrchv");
        expect(nameOf(0x2000, 0xf2)).toBe("os_text_ptr");
        expect(nameOf(0x2000, 0x20f)).toBeUndefined();
        expect(nameOf(0x2000, 0xe0a4)).toBeUndefined();
        expect(names.address(0xfff4)?.name).toBe("osbyte");
    });

    it("leaves a Master's addresses plain", async () => {
        const cpu = fake6502(findModel("Master"));
        await cpu.initialise();
        const names = await namesFor((address) => cpu.peekmem(address));
        expect(names.sets).toEqual([]);
        expect(names.operand(0x2000, 0xffee)).toBeUndefined();
        expect(loadReal.mock.calls.map(([url]) => url)).toEqual([`${RealSymbols}index.json`]);
    });

    it("leaves an Atom's addresses plain", async () => {
        const cpu = fake6502(findModel("Atom"));
        await cpu.initialise();
        const names = await namesFor((address) => cpu.peekmem(address));
        expect(names.sets).toEqual([]);
    });

    it.each(["bpos.rom", "usmos.rom", "os01.rom", "compact/os51.rom"])("leaves %s's addresses plain", async (rom) => {
        const memory = new Uint8Array(0x10000);
        memory.set(readFileSync(path.join(RomsDir, rom)).subarray(0, OsSize), OsBase);
        const names = await namesFor((address) => memory[address]);
        expect(names.sets).toEqual([]);
    });
});
